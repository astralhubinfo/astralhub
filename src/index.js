export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ===== 0. YouTubeからの通知(WebSub)は、パスワード認証を通さない =====
    if (url.pathname === "/websub/callback") {
      if (request.method === "GET") {
        return handleWebSubVerify(request, env);
      }
      if (request.method === "POST") {
        return handleWebSubNotification(request, env);
      }
    }

    // ===== 1. パスワードチェック(今までと同じ) =====
    const authHeader = request.headers.get("Authorization");
    let isAuthenticated = false;

    if (authHeader) {
      const [scheme, encoded] = authHeader.split(" ");
      if (scheme === "Basic" && encoded) {
        const decoded = atob(encoded);
        const separatorIndex = decoded.indexOf(":");
        const user = decoded.substring(0, separatorIndex);
        const pass = decoded.substring(separatorIndex + 1);
        if (user === env.BASIC_AUTH_USER && pass === env.BASIC_AUTH_PASS) {
          isAuthenticated = true;
        }
      }
    }

    if (!isAuthenticated) {
      return new Response("このサイトはただいま準備中です。", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="AstralHub - Preview"',
        },
      });
    }

    // ===== 2. チャンネル登録の受付窓口(API) =====

    // 窓口1:チャンネル一覧を取得する(GET /api/channels)
    if (url.pathname === "/api/channels" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT * FROM channels ORDER BY created_at DESC"
        ).all();
        return jsonResponse(results);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口2:チャンネルを1件登録する(POST /api/channels)
    if (url.pathname === "/api/channels" && request.method === "POST") {
      try {
        const body = await request.json();
        const result = await insertChannel(env.DB, body);
        await requestWebSubSubscribe(body.channel_id, env).catch(() => {});
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    // 窓口3:チャンネルをまとめて登録する(POST /api/channels/bulk)
    if (url.pathname === "/api/channels/bulk" && request.method === "POST") {
      try {
        const body = await request.json();
        const list = body.channels || [];
        const inserted = [];
        const skipped = [];

        for (const ch of list) {
          try {
            await insertChannel(env.DB, ch);
            inserted.push(ch.channel_id);
            await requestWebSubSubscribe(ch.channel_id, env).catch(() => {});
          } catch (err) {
            skipped.push({ channel_id: ch.channel_id, reason: err.message });
          }
        }

        return jsonResponse({ inserted, skipped });
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    // 窓口4:チャンネルを削除する(DELETE /api/channels/:channel_id)
    if (url.pathname.startsWith("/api/channels/") && request.method === "DELETE") {
      try {
        const channelId = decodeURIComponent(url.pathname.replace("/api/channels/", ""));
        await env.DB.prepare("DELETE FROM channels WHERE channel_id = ?")
          .bind(channelId)
          .run();
        await requestWebSubUnsubscribe(channelId, env).catch(() => {});
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口5:現在LIVE中のチャンネル一覧を取得する(GET /api/live)
    if (url.pathname === "/api/live" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          `SELECT ls.channel_id, ls.live_video_id, ls.title, ls.thumbnail_url, ls.viewer_count,
                  c.game, c.channel_name
           FROM live_status ls
           JOIN channels c ON c.channel_id = ls.channel_id
           WHERE ls.is_live = 1
           ORDER BY ls.viewer_count DESC`
        ).all();
        return jsonResponse(results);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口6:動画一覧を取得する(GET /api/videos?days=30 のように、何日以内かを指定できます)
    if (url.pathname === "/api/videos" && request.method === "GET") {
      try {
        const days = Number(url.searchParams.get("days")) || 30;
        const { results } = await env.DB.prepare(
          `SELECT v.video_id, v.channel_id, v.game, v.title, v.thumbnail_url,
                  v.published_at, v.view_count, v.duration_seconds,
                  c.channel_name
           FROM videos v
           LEFT JOIN channels c ON c.channel_id = v.channel_id
           WHERE v.published_at >= datetime('now', '-' || ? || ' days')
           ORDER BY v.published_at DESC`
        )
          .bind(days)
          .all();
        return jsonResponse(results);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口7:チャンネル自動発掘を実行する(POST /api/discover)
    // body例: { "gameId": "genshin" } ※省略した場合は全ゲームまとめて実行します
    if (url.pathname === "/api/discover" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const targetGameIds = body.gameId ? [body.gameId] : Object.keys(GAME_KEYWORDS);
        const summary = [];
        for (const gameId of targetGameIds) {
          const result = await discoverCandidatesForGame(gameId, env);
          summary.push({ gameId, ...result });
        }
        return jsonResponse({ summary });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口8:候補チャンネル一覧を取得する(GET /api/candidates?status=pending&gameId=genshin)
    if (url.pathname === "/api/candidates" && request.method === "GET") {
      try {
        const status = url.searchParams.get("status") || "pending";
        const gameId = url.searchParams.get("gameId");
        let query = "SELECT * FROM candidate_channels WHERE status = ?";
        const params = [status];
        if (gameId) {
          query += " AND game_id = ?";
          params.push(gameId);
        }
        query += " ORDER BY discovered_at DESC";
        const { results } = await env.DB.prepare(query)
          .bind(...params)
          .all();
        return jsonResponse(results);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口9:候補チャンネルを承認して本登録する(POST /api/candidates/:channel_id/approve)
    if (
      url.pathname.startsWith("/api/candidates/") &&
      url.pathname.endsWith("/approve") &&
      request.method === "POST"
    ) {
      try {
        const channelId = decodeURIComponent(
          url.pathname.replace("/api/candidates/", "").replace("/approve", "")
        );
        const candidate = await env.DB.prepare(
          "SELECT * FROM candidate_channels WHERE channel_id = ?"
        )
          .bind(channelId)
          .first();
        if (!candidate) return jsonResponse({ error: "候補が見つかりません" }, 404);

        await insertChannel(env.DB, {
          channel_id: candidate.channel_id,
          channel_name: candidate.channel_name,
          url: `https://www.youtube.com/channel/${candidate.channel_id}`,
          game: candidate.game_id,
        });
        await requestWebSubSubscribe(candidate.channel_id, env).catch(() => {});
        await env.DB.prepare(
          "UPDATE candidate_channels SET status = 'approved' WHERE channel_id = ?"
        )
          .bind(channelId)
          .run();

        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口10:候補チャンネルを不採用にする(POST /api/candidates/:channel_id/reject)
    if (
      url.pathname.startsWith("/api/candidates/") &&
      url.pathname.endsWith("/reject") &&
      request.method === "POST"
    ) {
      try {
        const channelId = decodeURIComponent(
          url.pathname.replace("/api/candidates/", "").replace("/reject", "")
        );
        await env.DB.prepare(
          "UPDATE candidate_channels SET status = 'rejected' WHERE channel_id = ?"
        )
          .bind(channelId)
          .run();
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ===== 3. どの窓口にも当てはまらない場合は、今まで通りサイトを表示 =====
    return env.ASSETS.fetch(request);
  },

  // ============================================================
  // ▼ここから追加:定期実行(Cron)の処理 ============================================
  // ============================================================
  async scheduled(controller, env, ctx) {
    if (controller.cron === "*/5 * * * *") {
      // 5分ごと:①通知期限が近いチャンネルの更新 ②LIVE中チャンネルの再確認
      ctx.waitUntil(renewExpiringSubscriptions(env));
      ctx.waitUntil(refreshLiveChannels(env));
    } else if (controller.cron === "*/30 * * * *") {
      // 30分ごと:人気動画の再生回数まとめ更新
      ctx.waitUntil(refreshRecentVideoStats(env));
    }
  },
};

// チャンネルを1件、データベースに登録する共通処理
async function insertChannel(db, ch) {
  if (!ch.channel_id) {
    throw new Error("channel_id は必須です");
  }
  await db
    .prepare(
      "INSERT INTO channels (channel_id, channel_name, url, game) VALUES (?, ?, ?, ?)"
    )
    .bind(ch.channel_id, ch.channel_name || "", ch.url || "", ch.game || "")
    .run();
  return { success: true, channel_id: ch.channel_id };
}

// JSON形式で返事を返すための共通処理
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================
// ▼WebSub(YouTubeからの自動通知)関連の処理 ============================================
// ============================================================

async function requestWebSubSubscribe(channelId, env) {
  return sendWebSubRequest(channelId, env, "subscribe");
}

async function requestWebSubUnsubscribe(channelId, env) {
  return sendWebSubRequest(channelId, env, "unsubscribe");
}

async function sendWebSubRequest(channelId, env, mode) {
  if (!channelId) return;
  const callbackUrl = `${env.SITE_URL}/websub/callback`;
  const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

  const formBody = new URLSearchParams({
    "hub.mode": mode,
    "hub.topic": topicUrl,
    "hub.callback": callbackUrl,
    "hub.verify": "async",
  });

  await fetch("https://pubsubhubbub.appspot.com/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });
}

async function handleWebSubVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const topic = url.searchParams.get("hub.topic");
  const challenge = url.searchParams.get("hub.challenge");
  const leaseSeconds = url.searchParams.get("hub.lease_seconds");

  if (!mode || !topic || !challenge) {
    return new Response("Bad Request", { status: 400 });
  }

  const channelId = extractChannelIdFromTopic(topic);
  if (!channelId) {
    return new Response("Bad Request", { status: 400 });
  }

  const channelRow = await env.DB.prepare(
    "SELECT channel_id FROM channels WHERE channel_id = ?"
  )
    .bind(channelId)
    .first();
  if (!channelRow) {
    return new Response("Not Found", { status: 404 });
  }

  if (mode === "subscribe") {
    const seconds = Number(leaseSeconds) || 432000;
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO websub_subscriptions (channel_id, subscribed_at, expires_at)
       VALUES (?, datetime('now'), ?)
       ON CONFLICT(channel_id) DO UPDATE SET subscribed_at=datetime('now'), expires_at=excluded.expires_at`
    )
      .bind(channelId, expiresAt)
      .run();
  } else if (mode === "unsubscribe") {
    await env.DB.prepare("DELETE FROM websub_subscriptions WHERE channel_id = ?")
      .bind(channelId)
      .run();
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

async function handleWebSubNotification(request, env) {
  const body = await request.text();
  const entries = extractAtomEntries(body);

  for (const entry of entries) {
    const { videoId, channelId } = entry;
    if (!videoId || !channelId) continue;

    const channelRow = await env.DB.prepare(
      "SELECT game FROM channels WHERE channel_id = ?"
    )
      .bind(channelId)
      .first();
    if (!channelRow) continue;

    await fetchAndStoreVideo(videoId, channelId, channelRow.game, env);
  }

  return new Response("OK", { status: 200 });
}

function extractAtomEntries(xml) {
  const entries = [];
  const entryBlocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const block of entryBlocks) {
    const videoId = (block.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const channelId = (block.match(/<yt:channelId>(.*?)<\/yt:channelId>/) || [])[1];
    entries.push({ videoId, channelId });
  }
  return entries;
}

function extractChannelIdFromTopic(topic) {
  const match = topic.match(/channel_id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function fetchAndStoreVideo(videoId, channelId, game, env) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${videoId}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return;
  const data = await res.json();
  const video = data.items && data.items[0];
  if (!video) return;

  const snippet = video.snippet || {};
  const contentDetails = video.contentDetails || {};
  const liveDetails = video.liveStreamingDetails || {};
  const statistics = video.statistics || {};
  const durationSeconds = parseIsoDuration(contentDetails.duration || "");
  const thumbnails = snippet.thumbnails || {};
  const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || "";

  if (snippet.liveBroadcastContent === "live") {
    await env.DB.prepare(
      `INSERT INTO live_status (channel_id, is_live, live_video_id, title, thumbnail_url, viewer_count, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(channel_id) DO UPDATE SET
         is_live=1, live_video_id=excluded.live_video_id, title=excluded.title,
         thumbnail_url=excluded.thumbnail_url, viewer_count=excluded.viewer_count, updated_at=datetime('now')`
    )
      .bind(channelId, videoId, snippet.title || "", thumbnail, Number(liveDetails.concurrentViewers) || 0)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO videos (video_id, channel_id, game, title, thumbnail_url, video_type, published_at, view_count, duration_seconds, updated_at)
     VALUES (?, ?, ?, ?, ?, 'video', ?, ?, ?, datetime('now'))
     ON CONFLICT(video_id) DO UPDATE SET
       title=excluded.title, thumbnail_url=excluded.thumbnail_url,
       view_count=excluded.view_count, duration_seconds=excluded.duration_seconds, updated_at=datetime('now')`
  )
    .bind(
      videoId,
      channelId,
      game || "",
      snippet.title || "",
      thumbnail,
      snippet.publishedAt || "",
      Number(statistics.viewCount) || 0,
      durationSeconds
    )
    .run();
}

function parseIsoDuration(iso) {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// ============================================================
// ▼ここから追加:定期実行(Cron)で使う処理 ============================================
// ============================================================

// ①通知の申し込み期限が近い(24時間以内)チャンネルを、自動で更新する
async function renewExpiringSubscriptions(env) {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT channel_id FROM websub_subscriptions WHERE expires_at < ?"
  )
    .bind(soon)
    .all();

  for (const row of results) {
    await requestWebSubSubscribe(row.channel_id, env).catch(() => {});
  }
}

// ②現在LIVE中とされているチャンネルだけ、最新の状況を確認する
async function refreshLiveChannels(env) {
  const { results } = await env.DB.prepare(
    "SELECT channel_id, live_video_id FROM live_status WHERE is_live = 1"
  ).all();
  if (results.length === 0) return;

  const videoIds = results.map(r => r.live_video_id).filter(Boolean);
  const videoMap = await fetchVideosBatched(videoIds, env);

  for (const row of results) {
    const video = videoMap[row.live_video_id];
    if (!video) {
      // 情報が取得できない(配信削除など) → LIVE状態を終了扱いにする
      await env.DB.prepare("UPDATE live_status SET is_live = 0 WHERE channel_id = ?")
        .bind(row.channel_id)
        .run();
      continue;
    }
    const snippet = video.snippet || {};
    if (snippet.liveBroadcastContent === "live") {
      // まだLIVE中 → 視聴者数だけ更新
      const viewerCount = Number((video.liveStreamingDetails || {}).concurrentViewers) || 0;
      await env.DB.prepare(
        "UPDATE live_status SET viewer_count = ?, updated_at = datetime('now') WHERE channel_id = ?"
      )
        .bind(viewerCount, row.channel_id)
        .run();
    } else {
      // LIVEが終了した → is_liveを0にする(動画・アーカイブとしての保存はwebsub通知側で行われます)
      await env.DB.prepare("UPDATE live_status SET is_live = 0 WHERE channel_id = ?")
        .bind(row.channel_id)
        .run();
    }
  }
}

// ③直近30日間に投稿された動画の再生回数を、まとめて更新する(人気動画ランキング用)
async function refreshRecentVideoStats(env) {
  const { results } = await env.DB.prepare(
    "SELECT video_id FROM videos WHERE published_at >= datetime('now', '-30 days')"
  ).all();
  if (results.length === 0) return;

  const videoIds = results.map(r => r.video_id);
  const videoMap = await fetchVideosBatched(videoIds, env);

  for (const videoId of videoIds) {
    const video = videoMap[videoId];
    if (!video) continue;
    const statistics = video.statistics || {};
    await env.DB.prepare(
      "UPDATE videos SET view_count = ?, updated_at = datetime('now') WHERE video_id = ?"
    )
      .bind(Number(statistics.viewCount) || 0, videoId)
      .run();
  }
}

// 動画IDの配列を、50件ずつまとめてYouTubeに問い合わせる共通処理(API節約のため)
async function fetchVideosBatched(videoIds, env) {
  const videoMap = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails,statistics&id=${chunk.join(",")}&key=${env.YOUTUBE_API_KEY}`;
    const res = await fetch(apiUrl);
    if (!res.ok) continue;
    const data = await res.json();
    for (const video of data.items || []) {
      videoMap[video.id] = video;
    }
  }
  return videoMap;
}

// ============================================================
// ▼ここから追加:チャンネル自動発掘(候補精査)関連の処理 ============================================
// ============================================================

// ゲームごとの検索キーワード
// ※ assets/config.js の GAME_KEYWORDS と同じ内容にしてください(ゲームを追加した場合は両方直す)
const GAME_KEYWORDS = {
  genshin: ["原神", "Genshin", "げんしん"],
  hsr: ["スターレイル", "崩壊：スターレイル", "崩壊:スターレイル", "HSR", "Honkai: Star Rail"],
  zzz: ["ゼンレスゾーンゼロ", "ゼンゼロ", "ZZZ", "Zenless"],
  ww: ["鳴潮", "めいちょう", "Wuthering Waves"],
  nte: ["NTE"],
};

// 候補として残すための基準
const CANDIDATE_MIN_SUBSCRIBERS = 100; // 登録者数がこれ未満は除外
const CANDIDATE_MIN_RELEVANCE = 0.3; // 直近動画のうち、このゲームの動画の割合がこれ未満は除外
const CANDIDATE_ACTIVITY_DAYS = 30; // この日数以内にそのゲームの動画がなければ除外
const CANDIDATE_CHECK_VIDEO_COUNT = 20; // 関連度を調べるとき、直近何件の動画をチェックするか

// 1つのゲームについて、候補チャンネルを検索→精査→保存する
async function discoverCandidatesForGame(gameId, env) {
  const keywords = GAME_KEYWORDS[gameId];
  if (!keywords) {
    throw new Error(`gameId「${gameId}」のキーワードが見つかりません`);
  }

  const publishedAfter = new Date(
    Date.now() - CANDIDATE_ACTIVITY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // ① キーワードごとに直近1ヶ月の動画を検索し、候補チャンネルIDと「最新の関連動画の投稿日」を集める
  const foundChannels = new Map(); // channelId -> { lastRelatedVideoAt }
  for (const keyword of keywords) {
    const items = await searchRecentVideosByKeyword(keyword, publishedAfter, env);
    for (const item of items) {
      const channelId = item.snippet.channelId;
      const publishedAt = item.snippet.publishedAt;
      const existing = foundChannels.get(channelId);
      if (!existing || publishedAt > existing.lastRelatedVideoAt) {
        foundChannels.set(channelId, { lastRelatedVideoAt: publishedAt });
      }
    }
  }

  if (foundChannels.size === 0) {
    return { found: 0, added: 0 };
  }

  // ② すでに本登録済み・すでに候補になっているチャンネルは除外する
  const existingIds = await getExistingChannelIds(env);
  const newChannelIds = [...foundChannels.keys()].filter(id => !existingIds.has(id));

  if (newChannelIds.length === 0) {
    return { found: foundChannels.size, added: 0 };
  }

  // ③ チャンネルの詳細情報(登録者数など)をまとめて取得し、登録者数でふるいにかける
  const channelDetails = await fetchChannelDetailsBatched(newChannelIds, env);
  const bySubscribers = channelDetails.filter(
    ch => (Number(ch.statistics.subscriberCount) || 0) >= CANDIDATE_MIN_SUBSCRIBERS
  );

  // ④ 残ったチャンネルについて、直近の投稿を調べて「関連度」を計算する
  let addedCount = 0;
  for (const ch of bySubscribers) {
    const uploadsPlaylistId = (ch.contentDetails.relatedPlaylists || {}).uploads;
    if (!uploadsPlaylistId) continue;

    const recentTitles = await fetchRecentUploadTitles(
      uploadsPlaylistId,
      CANDIDATE_CHECK_VIDEO_COUNT,
      env
    );
    if (recentTitles.length === 0) continue;

    const relatedCount = recentTitles.filter(t => matchesAnyKeyword(t, keywords)).length;
    const relevanceScore = relatedCount / recentTitles.length;

    if (relevanceScore < CANDIDATE_MIN_RELEVANCE) continue;

    const thumbnails = ch.snippet.thumbnails || {};
    const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || "";
    const lastRelatedVideoAt = foundChannels.get(ch.id).lastRelatedVideoAt;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO candidate_channels
        (channel_id, channel_name, game_id, subscriber_count, relevance_score, last_related_video_at, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        ch.id,
        ch.snippet.title || "",
        gameId,
        Number(ch.statistics.subscriberCount) || 0,
        relevanceScore,
        lastRelatedVideoAt,
        thumbnail
      )
      .run();

    addedCount++;
  }

  return { found: foundChannels.size, added: addedCount };
}

// すでに「本登録済み」または「候補として保存済み」のチャンネルIDを集める(重複を避けるため)
async function getExistingChannelIds(env) {
  const registered = await env.DB.prepare("SELECT channel_id FROM channels").all();
  const candidates = await env.DB.prepare("SELECT channel_id FROM candidate_channels").all();
  const ids = new Set();
  for (const row of registered.results) ids.add(row.channel_id);
  for (const row of candidates.results) ids.add(row.channel_id);
  return ids;
}

// キーワードで、直近の動画を検索する(YouTube search API)
async function searchRecentVideosByKeyword(keyword, publishedAfter, env) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=50&publishedAfter=${encodeURIComponent(
    publishedAfter
  )}&q=${encodeURIComponent(keyword)}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

// チャンネルIDの配列から、詳細情報(登録者数・アップロード一覧の場所など)をまとめて取得する
async function fetchChannelDetailsBatched(channelIds, env) {
  const details = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${chunk.join(
      ","
    )}&key=${env.YOUTUBE_API_KEY}`;
    const res = await fetch(apiUrl);
    if (!res.ok) continue;
    const data = await res.json();
    details.push(...(data.items || []));
  }
  return details;
}

// アップロード動画一覧(再生リスト)から、直近の動画タイトルを取得する
async function fetchRecentUploadTitles(uploadsPlaylistId, maxResults, env) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${maxResults}&playlistId=${uploadsPlaylistId}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(item => item.snippet.title || "");
}

// タイトルが、指定したキーワードのどれかを含んでいるか判定する
function matchesAnyKeyword(title, keywords) {
  const lowerTitle = title.toLowerCase();
  return keywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
}
