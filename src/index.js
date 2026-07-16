export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ===== 0. YouTubeからの通知(WebSub)は、パスワード認証を通さない =====
    // (Googleのサーバーからのアクセスなので、IDやパスワードは入力できません)
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

    // ===== 2. チャンネル登録の受付窓口(API)(前回作成分・変更なし) =====

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
        return jsonResponse({ success: true });
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
// ▼ここから追加:WebSub(YouTubeからの自動通知)関連の処理 ============================================
// ============================================================

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

  // 登録されていないチャンネルからの申し込みは拒否する(なりすまし防止)
  const channelRow = await env.DB.prepare(
    "SELECT channel_id FROM channels WHERE channel_id = ?"
  )
    .bind(channelId)
    .first();
  if (!channelRow) {
    return new Response("Not Found", { status: 404 });
  }

  if (mode === "subscribe") {
    const seconds = Number(leaseSeconds) || 432000; // 指定が無ければ5日として扱う
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

  // hub.challengeをそのまま返すことで、申し込みが確定する(WebSubの決まりごと)
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

    // 登録されていないチャンネルからの通知は無視する(なりすまし防止)
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

// 通知のXMLから、動画IDとチャンネルIDの組み合わせを取り出す(簡易的な読み取り処理)
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

// 申し込みURL(topic)から、チャンネルIDだけを取り出す
function extractChannelIdFromTopic(topic) {
  const match = topic.match(/channel_id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// 動画IDをもとに、YouTube側の詳しい情報を取得してデータベースに保存する
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
    // 現在LIVE配信中の場合 → live_status テーブルを更新
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

  // 通常動画・アーカイブの場合 → videos テーブルに保存(新規 or 情報更新)
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

// "PT1H2M3S" のようなYouTube独特の時間表記を、秒数(数字)に変換する
function parseIsoDuration(iso) {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}
