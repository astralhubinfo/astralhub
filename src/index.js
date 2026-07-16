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
        // 登録成功後、YouTubeへ通知をお願いする(結果は待たずに実行、失敗しても登録自体は成功扱い)
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

    // 窓口5(今回限定・お掃除用):今すでに登録されている全チャンネル分、まとめて通知をお願いする
    // これを使い終わったら、この窓口はステップDで削除します。
    if (url.pathname === "/api/channels/resubscribe-all" && request.method === "POST") {
      try {
        const { results } = await env.DB.prepare("SELECT channel_id FROM channels").all();
        const done = [];
        for (const row of results) {
          await requestWebSubSubscribe(row.channel_id, env).catch(() => {});
          done.push(row.channel_id);
        }
        return jsonResponse({ requested: done });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ===== 3. どの窓口にも当てはまらない場合は、今まで通りサイトを表示 =====
    return env.ASSETS.fetch(request);
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

// YouTubeへ「このチャンネルの新着を通知してください」とお願いする(申し込み)
async function requestWebSubSubscribe(channelId, env) {
  return sendWebSubRequest(channelId, env, "subscribe");
}

// YouTubeへ「通知はもう不要です」と伝える(解除、チャンネル削除時に使用)
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

// YouTube(Googleのhubサーバー)からの「通知していいですか?」という確認に応答する
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

// YouTubeからの「新しい動画・配信が出ました」という通知を受け取る
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
