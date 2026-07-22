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
        await requestWebSubSubscribe(body.channel_id, env).catch(err =>
          console.error("[AstralHub] WebSub登録に失敗しました", err)
        );
        const syncResult = await syncChannelInitialContent(body.channel_id, body.game, env).catch(err => {
          console.error("[AstralHub] 初回の動画取り込みに失敗しました", err);
          return { synced: 0, error: err.message };
        });
        return jsonResponse({ ...result, synced: syncResult.synced, syncError: syncResult.error || null });
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
    // ※チャンネル本体だけでなく、そのチャンネルの動画・配信状況のデータも一緒に削除する。
    //   (以前はチャンネルだけ消して動画は残っていたため、削除したはずのチャンネルの動画が
    //    トップページに表示され続けてしまう不具合がありました)
    if (url.pathname.startsWith("/api/channels/") && request.method === "DELETE") {
      try {
        const channelId = decodeURIComponent(url.pathname.replace("/api/channels/", ""));
        await env.DB.batch([
          env.DB.prepare("DELETE FROM channels WHERE channel_id = ?").bind(channelId),
          env.DB.prepare("DELETE FROM videos WHERE channel_id = ?").bind(channelId),
          env.DB.prepare("DELETE FROM live_status WHERE channel_id = ?").bind(channelId),
          env.DB.prepare("DELETE FROM websub_subscriptions WHERE channel_id = ?").bind(channelId),
        ]);
        await requestWebSubUnsubscribe(channelId, env).catch(() => {});
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口4.5:登録チャンネルの整合性をチェックする(GET /api/channels/verify)
    // ※チャンネルIDの取り違え(拡張機能が違うチャンネルのIDを拾ってしまった等)を見つけるための機能。
    //   登録されている全チャンネルについて、YouTube側の「本当の名前」を問い合わせて、
    //   サイトに保存されている名前と食い違っているもの・そもそも見つからないものだけを返す。
    if (url.pathname === "/api/channels/verify" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT channel_id, channel_name, game FROM channels"
        ).all();

        if (results.length === 0) {
          return jsonResponse({ checked: 0, problems: [] });
        }

        const channelIds = results.map(r => r.channel_id);
        const channelDetails = await fetchChannelDetailsBatched(channelIds, env);
        const detailsMap = new Map(channelDetails.map(ch => [ch.id, ch]));

        const problems = [];
        for (const row of results) {
          const ch = detailsMap.get(row.channel_id);

          if (!ch) {
            // YouTube側に見つからない(IDが間違っている・削除された・非公開になった等)
            problems.push({
              channel_id: row.channel_id,
              game: row.game,
              savedName: row.channel_name,
              actualName: null,
              reason: "not_found",
            });
            continue;
          }

          const actualName = (ch.snippet && ch.snippet.title) || "";
          // 登録時に名前が空だったものは比較のしようがないため、対象外にする
          if (row.channel_name && actualName && row.channel_name !== actualName) {
            problems.push({
              channel_id: row.channel_id,
              game: row.game,
              savedName: row.channel_name,
              actualName,
              reason: "name_mismatch",
            });
          }
        }

        return jsonResponse({ checked: results.length, problems });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ===== 2.5 ニュース記事の受付窓口(API) =====
    // ※以前はブラウザのlocalStorageだけに保存していましたが、それだと管理人本人以外には
    //   一切表示されなかったため、チャンネル・動画・配信と同じくデータベース(D1)に保存する形にしました。

    // 窓口4-A:ニュース一覧を取得する(GET /api/news)
    // 「固定表示」を先頭、それ以外は投稿日の新しい順に並べて返す
    // 通常は「公開済み(published)」のものだけを返す(サイト側の表示用)。
    // 管理画面が下書きも含めて全件見たい場合は ?all=1 を付けて呼び出す。
    if (url.pathname === "/api/news" && request.method === "GET") {
      try {
        const includeAll = url.searchParams.get("all") === "1";
        const whereClause = includeAll ? "" : "WHERE COALESCE(status, 'published') = 'published'";
        const { results } = await env.DB.prepare(
          `SELECT id, game, cat, pinned, title, summary, url, published_at AS publishedAt,
                  gacha_start AS gachaStart, gacha_end AS gachaEnd, gacha_items AS gachaItems,
                  COALESCE(status, 'published') AS status
           FROM news
           ${whereClause}
           ORDER BY (pinned = 'pinned') DESC, published_at DESC`
        ).all();
        return jsonResponse(results);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口4-B:ニュースを1件登録・更新する(POST /api/news)
    // body に id があれば既存記事の更新(投稿日時は変えない)、なければ新規登録として扱う
    // 管理画面からの通常登録は、これまで通りすぐに「公開済み」として扱う
    if (url.pathname === "/api/news" && request.method === "POST") {
      try {
        const body = await request.json();
        const result = await saveNewsItem(env.DB, { ...body, status: body.status || "published" });
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    // 窓口4-B':下書きを1件登録する(POST /api/news/draft)
    // Chrome拡張機能から、Xの投稿を「下書き」として送るための専用の窓口。
    // タイトルなどが空でも受け付け、必ず status: 'draft' として保存する(サイトには表示されない)。
    // 管理画面で内容を確認・編集し、「公開する」を押すまでは表に出ない。
    if (url.pathname === "/api/news/draft" && request.method === "POST") {
      try {
        const body = await request.json();
        const result = await saveNewsItem(env.DB, { ...body, status: "draft" });
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    // 窓口4-C:ニュースを1件削除する(DELETE /api/news/:id)
    if (url.pathname.startsWith("/api/news/") && request.method === "DELETE") {
      try {
        const id = decodeURIComponent(url.pathname.replace("/api/news/", ""));
        await env.DB.prepare("DELETE FROM news WHERE id = ?").bind(id).run();
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
                  COALESCE(NULLIF(ls.game, ''), c.game) AS game, c.channel_name
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
                  v.published_at, v.view_count, v.duration_seconds, v.video_type,
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

    // 窓口7:キーワードを1つ検索し、見つかったチャンネルを「審査待ちの箱」に入れる(POST /api/discover/search)
    // body例: { "gameId": "genshin", "keyword": "原神", "minSubscribers": 300, "secondaryKeywords": ["確率炉"], "streamOnly": true }
    // ※1回あたりの通信量を抑えるため、検索だけを行い、詳しい審査は次の窓口(8)で小分けに行います
    // ※minSubscribers(最低登録者数)・secondaryKeywords(副次キーワード)は、審査待ちの箱に一緒に
    //   保存しておき、次の窓口(8)で審査するときにこの条件で判定します。
    // ※streamOnly(配信のみ)は、検索範囲を「配信(ライブのアーカイブ)」だけに絞り込むかどうかの指定です。
    if (url.pathname === "/api/discover/search" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        if (!body.gameId || !body.keyword) {
          return jsonResponse({ error: "gameId と keyword は必須です" }, 400);
        }
        const result = await queueSearchResults(
          body.gameId,
          body.keyword,
          body.minSubscribers,
          body.secondaryKeywords,
          !!body.streamOnly,
          env
        );
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口8:「審査待ちの箱」から少しずつ(規定件数まで)取り出して審査する(POST /api/discover/process)
    // ※Cloudflareの「1回の実行につき外部通信50回まで」という上限を超えないよう、少しずつ処理します。
    //   箱が空になるまで、admin.html側からこの窓口を繰り返し呼び出します。
    if (url.pathname === "/api/discover/process" && request.method === "POST") {
      try {
        const result = await processDiscoveryQueueBatch(env);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口9:候補チャンネル一覧を取得する(GET /api/candidates?status=pending&gameId=genshin)
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

    // 窓口10:候補チャンネルを承認して本登録する(POST /api/candidates/:channel_id/approve)
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
        await requestWebSubSubscribe(candidate.channel_id, env).catch(err =>
          console.error("[AstralHub] WebSub登録に失敗しました", err)
        );
        const syncResult = await syncChannelInitialContent(candidate.channel_id, candidate.game_id, env).catch(err => {
          console.error("[AstralHub] 初回の動画取り込みに失敗しました", err);
          return { synced: 0, error: err.message };
        });
        await env.DB.prepare(
          "UPDATE candidate_channels SET status = 'approved' WHERE channel_id = ?"
        )
          .bind(channelId)
          .run();

        return jsonResponse({ success: true, synced: syncResult.synced, syncError: syncResult.error || null });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 窓口11:候補チャンネルを不採用にする(POST /api/candidates/:channel_id/reject)
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

    // 窓口12:却下済みの候補を、今の基準で少しずつ見直す(POST /api/candidates/rescreen)
    // ※基準を変更したときに、それまで却下されていたチャンネルにもう一度チャンスを与えるための窓口
    // body例: { "before": "2026-07-22T12:00:00.000Z" }(見直し作業を始めた時刻。省略時は現在時刻)
    if (url.pathname === "/api/candidates/rescreen" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const result = await rescreenPendingCandidates(env, body.before);
        return jsonResponse(result);
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

// ニュースを1件、登録または更新する。
// idが指定されていれば、そのidの行を更新する(登録日時は変えない)。
// idが指定されていなければ、新しいidを発行して新規登録する(登録日時は今の時刻にする)。
async function saveNewsItem(db, item) {
  // ガチャのピックアップ一覧は、配列のまま保存できないため、文字列(JSON)に変換して保存する
  const gachaItemsJson = JSON.stringify(Array.isArray(item.gachaItems) ? item.gachaItems : []);
  const status = item.status === "draft" ? "draft" : "published";

  if (item.id) {
    await db
      .prepare(
        `UPDATE news SET game=?, cat=?, pinned=?, title=?, summary=?, url=?,
                gacha_start=?, gacha_end=?, gacha_items=?, status=? WHERE id=?`
      )
      .bind(
        item.game || "",
        item.cat || "",
        item.pinned || "",
        item.title || "",
        item.summary || "",
        item.url || "",
        item.gachaStart || "",
        item.gachaEnd || "",
        gachaItemsJson,
        status,
        item.id
      )
      .run();
    return { id: item.id };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO news (id, game, cat, pinned, title, summary, url, published_at,
              gacha_start, gacha_end, gacha_items, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`
    )
    .bind(
      id,
      item.game || "",
      item.cat || "",
      item.pinned || "",
      item.title || "",
      item.summary || "",
      item.url || "",
      item.gachaStart || "",
      item.gachaEnd || "",
      gachaItemsJson,
      status
    )
    .run();
  return { id };
}

// チャンネルを1件、データベースに登録する共通処理
async function insertChannel(db, ch) {
  if (!ch.channel_id) {
    throw new Error("channel_id は必須です");
  }
  // すでに同じチャンネルIDが登録されていた場合は、エラーにせず情報を上書き更新する
  // (これにより、同じチャンネルを登録し直すだけで動画の再取得ができるようになる)
  await db
    .prepare(
      `INSERT INTO channels (channel_id, channel_name, url, game) VALUES (?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         channel_name = excluded.channel_name,
         url = excluded.url,
         game = excluded.game`
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

  if (!env.SITE_URL) {
    console.error("[AstralHub][WebSub] env.SITE_URLが設定されていないため、通知の予約ができません");
    return;
  }

  const callbackUrl = `${env.SITE_URL}/websub/callback`;
  const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

  const formBody = new URLSearchParams({
    "hub.mode": mode,
    "hub.topic": topicUrl,
    "hub.callback": callbackUrl,
    "hub.verify": "async",
  });

  const res = await fetch("https://pubsubhubbub.appspot.com/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[AstralHub][WebSub] ${mode}リクエストがハブ側で失敗しました status=${res.status} channelId=${channelId} callbackUrl=${callbackUrl} response=${text}`
    );
  } else {
    console.log(
      `[AstralHub][WebSub] ${mode}リクエストをハブに送信しました channelId=${channelId} callbackUrl=${callbackUrl}`
    );
  }
}

async function handleWebSubVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const topic = url.searchParams.get("hub.topic");
  const challenge = url.searchParams.get("hub.challenge");
  const leaseSeconds = url.searchParams.get("hub.lease_seconds");

  console.log(`[AstralHub][WebSub] 確認リクエストを受信しました mode=${mode} topic=${topic}`);

  if (!mode || !topic || !challenge) {
    console.error("[AstralHub][WebSub] 確認リクエストのパラメータが不足しています", url.toString());
    return new Response("Bad Request", { status: 400 });
  }

  const channelId = extractChannelIdFromTopic(topic);
  if (!channelId) {
    console.error("[AstralHub][WebSub] topicからチャンネルIDを抽出できませんでした", topic);
    return new Response("Bad Request", { status: 400 });
  }

  const channelRow = await env.DB.prepare(
    "SELECT channel_id FROM channels WHERE channel_id = ?"
  )
    .bind(channelId)
    .first();
  if (!channelRow) {
    console.error("[AstralHub][WebSub] 登録されていないチャンネルからの確認リクエストです", channelId);
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
      "SELECT channel_id FROM channels WHERE channel_id = ?"
    )
      .bind(channelId)
      .first();
    if (!channelRow) continue;

    await fetchAndStoreVideo(videoId, channelId, env);
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

async function fetchAndStoreVideo(videoId, channelId, env) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${videoId}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return;
  const data = await res.json();
  const video = data.items && data.items[0];
  if (!video) return;

  const action = resolveVideoAction(video, channelId);
  if (!action.save) return; // ショート動画・配信アーカイブ・ゲーム判定不可のいずれかのため保存しない

  const snippet = video.snippet || {};
  const liveDetails = video.liveStreamingDetails || {};
  const statistics = video.statistics || {};
  const thumbnails = snippet.thumbnails || {};
  const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || "";

  if (action.kind === "live") {
    await env.DB.prepare(
      `INSERT INTO live_status (channel_id, is_live, live_video_id, title, thumbnail_url, viewer_count, game, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(channel_id) DO UPDATE SET
         is_live=1, live_video_id=excluded.live_video_id, title=excluded.title,
         thumbnail_url=excluded.thumbnail_url, viewer_count=excluded.viewer_count,
         game=excluded.game, updated_at=datetime('now')`
    )
      .bind(channelId, videoId, snippet.title || "", thumbnail, Number(liveDetails.concurrentViewers) || 0, action.gameId)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO videos (video_id, channel_id, game, title, thumbnail_url, video_type, published_at, view_count, duration_seconds, rescreened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'video', ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(video_id) DO UPDATE SET
       game=excluded.game, title=excluded.title, thumbnail_url=excluded.thumbnail_url,
       view_count=excluded.view_count, duration_seconds=excluded.duration_seconds,
       rescreened_at=datetime('now'), updated_at=datetime('now')`
  )
    .bind(
      videoId,
      channelId,
      action.gameId,
      snippet.title || "",
      thumbnail,
      snippet.publishedAt || "",
      Number(statistics.viewCount) || 0,
      action.durationSeconds
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
// ▼ここから追加:動画・配信の内容精査(ゲーム判定・ショート動画/アーカイブ除外) ============================================
// 役割:
//   ①タイトルから実際にプレイ・紹介されているゲームを判定し、登録チャンネルのゲームと違っていても
//     正しいゲームのタグに切り替える。どのゲームか判定できない内容(雑談動画など)は保存しない。
//   ②ショート動画(60秒以内、または #shorts #ショート などのハッシュタグが付いた動画)を除外する。
//   ③配信予定(プレミア公開待ちなど)・配信が終わった直後にYouTubeからの通知で届いたものは、
//     この関数では保存しない(save:false)。
//     ※配信アーカイブ自体は、この関数とは別に refreshLiveChannels() 内で
//       「検索専用データ(video_type='archive')」として保存する仕組みを別途用意している
//       (人気・新着・公式チャンネル一覧には出したくないため、あえてこの関数の対象外にしている)。
// ============================================================

const SHORT_VIDEO_MAX_SECONDS = 75; // これ以下の長さは、ショート動画とみなして除外する(1分15秒)

// ▼公式チャンネル(特別枠)の一覧 ============================================
// ここに登録したチャンネルは、動画の「長さ」によるショート判定を行いません。
// (ゲーム内CMやムービーなど、30秒前後の正規動画を公式が投稿する傾向があるため)
// ただし、#shorts などのハッシュタグが付いている場合は、公式チャンネルでも
// これまで通りショートとして除外されます。
//
// ※このリストは assets/site-data.js 内の OFFICIAL_CHANNELS と
//   同じ内容にしてください(チャンネルを追加・削除する場合は両方直す必要があります)。
const OFFICIAL_CHANNEL_IDS = new Set([
  'UCAVR6Q0YgYa8xwz8rdg9Mrg', // 原神 公式チャンネル
  'UCrzCIt5o0X88G9bCdrdbv6g', // 崩壊：スターレイル 公式チャンネル
  'UCt09C9DPSuOGpHoitbcyCIQ', // ゼンレスゾーンゼロ 公式チャンネル
  'UCGc93NguHRwzv1Rw9MyIcxQ', // 鳴潮 公式チャンネル
  'UClKUii0-uZwx6QOFIEJ1foA', // NTE 公式チャンネル
]);

// タイトル・概要欄に、ショート動画を示すハッシュタグが含まれているか判定する
function hasShortsHashtag(snippet) {
  const text = `${snippet.title || ""} ${snippet.description || ""}`;
  if (/#shorts?(?=\s|$|[^a-z0-9])/i.test(text)) return true;
  if (text.includes("#ショート")) return true;
  return false;
}

// 動画の長さ・ハッシュタグから、ショート動画かどうかを判定する
// isOfficial が true の場合、長さによる判定はスキップする(ハッシュタグ判定のみ行う)
function isShortVideo(snippet, durationSeconds, isOfficial) {
  if (!isOfficial && durationSeconds > 0 && durationSeconds <= SHORT_VIDEO_MAX_SECONDS) return true;
  return hasShortsHashtag(snippet);
}

// タイトルから、実際にプレイ・紹介されているゲームを判定する(該当なしはnullを返す)
function classifyGameIdForItem(title) {
  if (!title) return null;
  for (const gameId of Object.keys(GAME_KEYWORDS)) {
    if (matchesAnyKeyword(title, GAME_KEYWORDS[gameId])) {
      return gameId;
    }
  }
  return null;
}

// 動画・配信1件分の情報から、「保存すべきか」「保存する場合は配信か動画か・どのゲームか」を判定する
// channelId: 公式チャンネルかどうかの判定に使用します
// 戻り値: { save: false } または { save: true, kind: 'live'|'video', gameId, durationSeconds }
function resolveVideoAction(video, channelId) {
  const snippet = video.snippet || {};
  const contentDetails = video.contentDetails || {};
  const durationSeconds = parseIsoDuration(contentDetails.duration || "");
  const isCurrentlyLive = snippet.liveBroadcastContent === "live";
  const isLiveRelated = !!video.liveStreamingDetails; // 配信中・配信予定・配信アーカイブのいずれか
  const isOfficial = OFFICIAL_CHANNEL_IDS.has(channelId);

  // 配信が終わった後のアーカイブ・配信予定のものは、動画一覧には出さない
  if (isLiveRelated && !isCurrentlyLive) {
    return { save: false };
  }

  // ショート動画は除外する(配信中のものは対象外)
  if (!isCurrentlyLive && isShortVideo(snippet, durationSeconds, isOfficial)) {
    return { save: false };
  }

  // タイトルから実際のゲームを判定する。判定できなければ除外する
  const gameId = classifyGameIdForItem(snippet.title || "");
  if (!gameId) {
    return { save: false };
  }

  return { save: true, kind: isCurrentlyLive ? "live" : "video", gameId, durationSeconds };
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
      // まだLIVE中 → 視聴者数と、タイトルから判定したゲームタグを更新する
      // (配信中にタイトルを変えて別のゲームに切り替えた場合も、ここで自動的に反映されます)
      const viewerCount = Number((video.liveStreamingDetails || {}).concurrentViewers) || 0;
      const gameId = classifyGameIdForItem(snippet.title || "");
      if (gameId) {
        await env.DB.prepare(
          "UPDATE live_status SET viewer_count = ?, game = ?, updated_at = datetime('now') WHERE channel_id = ?"
        )
          .bind(viewerCount, gameId, row.channel_id)
          .run();
      } else {
        // タイトルからゲームを判定できなかった場合は、タグは変えずに視聴者数だけ更新する
        await env.DB.prepare(
          "UPDATE live_status SET viewer_count = ?, updated_at = datetime('now') WHERE channel_id = ?"
        )
          .bind(viewerCount, row.channel_id)
          .run();
      }
    } else {
      // LIVEが終了した
      // ▼ここから追加:配信アーカイブを「検索専用」として videos テーブルに保存する ============
      // 「人気動画」「新着動画」「公式チャンネル」一覧には出さず、動画検索でチェックを入れた時だけ
      // 見つかる、という扱いにするため、video_type を 'archive' にして保存する。
      // 通常動画と同じく、ショート判定(75秒以下除外・公式チャンネルはハッシュタグ判定のみ)と
      // ゲーム判定(タイトルからゲーム名を判定できないものは保存しない)を行う。
      const archiveDurationSeconds = parseIsoDuration((video.contentDetails || {}).duration || "");
      const archiveIsOfficial = OFFICIAL_CHANNEL_IDS.has(row.channel_id);
      if (!isShortVideo(snippet, archiveDurationSeconds, archiveIsOfficial)) {
        const archiveGameId = classifyGameIdForItem(snippet.title || "");
        if (archiveGameId) {
          const archiveStatistics = video.statistics || {};
          const archiveThumbnails = snippet.thumbnails || {};
          const archiveThumbnail = (archiveThumbnails.medium || archiveThumbnails.high || archiveThumbnails.default || {}).url || "";
          await env.DB.prepare(
            `INSERT INTO videos (video_id, channel_id, game, title, thumbnail_url, video_type, published_at, view_count, duration_seconds, rescreened_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'archive', ?, ?, ?, datetime('now'), datetime('now'))
             ON CONFLICT(video_id) DO UPDATE SET
               game=excluded.game, title=excluded.title, thumbnail_url=excluded.thumbnail_url,
               view_count=excluded.view_count, duration_seconds=excluded.duration_seconds,
               video_type=excluded.video_type, rescreened_at=datetime('now'), updated_at=datetime('now')`
          )
            .bind(
              row.live_video_id,
              row.channel_id,
              archiveGameId,
              snippet.title || "",
              archiveThumbnail,
              snippet.publishedAt || "",
              Number(archiveStatistics.viewCount) || 0,
              archiveDurationSeconds
            )
            .run();
        }
      }
      // ▲ここまで追加 ============================================
      // is_liveを0にする
      await env.DB.prepare("UPDATE live_status SET is_live = 0 WHERE channel_id = ?")
        .bind(row.channel_id)
        .run();
    }
  }
}

// ③直近30日間に投稿された動画を、まとめて最新の状態に更新する
// (再生数だけでなく、タイトル・サムネイルも取り直し、タイトルからゲーム判定もやり直す。
//  投稿者があとからタイトルを訂正した場合や、判定不可になった場合にも自動で追従できるようにするため)
//
// ▼ここから追加:投稿からの経過日数によって、チェックする頻度を変える ============================================
// 人気動画ランキングが「24時間」「7日間」「30日間」の3つの窓で分かれていることに合わせて、
// 再チェックの頻度も次の3段階に分ける(APIの消費量を抑えるため)。
//   Tier A（投稿から24時間以内）      : 今まで通り毎回チェック（30分ごと）
//   Tier B（投稿から24時間〜7日以内） : 3時間に1回チェック
//   Tier C（投稿から7日〜30日以内）   : 1日1回チェック
// 「前回いつチェックしたか」は、既存の rescreened_at 列を使って判定する(新しい列の追加は不要)。
// しきい値は、Cronの実行タイミングが多少ずれても取りこぼさないよう、少し短めに設定している。
// ============================================================
async function refreshRecentVideoStats(env) {
  const { results } = await env.DB.prepare(
    `SELECT video_id, channel_id FROM videos
     WHERE video_type != 'archive'
       AND published_at >= datetime('now', '-30 days')
       AND (
         (published_at >= datetime('now', '-1 days') AND rescreened_at <= datetime('now', '-20 minutes'))
         OR (published_at >= datetime('now', '-7 days') AND published_at < datetime('now', '-1 days') AND rescreened_at <= datetime('now', '-170 minutes'))
         OR (published_at < datetime('now', '-7 days') AND rescreened_at <= datetime('now', '-1380 minutes'))
       )`
  ).all();
  if (results.length === 0) return;

  const videoIds = results.map(r => r.video_id);
  const channelIdByVideoId = {};
  for (const row of results) {
    channelIdByVideoId[row.video_id] = row.channel_id;
  }
  const videoMap = await fetchVideosBatched(videoIds, env);

  const updateStatements = [];
  const deleteIds = [];

  for (const videoId of videoIds) {
    const video = videoMap[videoId];
    if (!video) {
      // YouTube側ですでに削除・非公開になっている → 一覧から取り除く
      deleteIds.push(videoId);
      continue;
    }

    // 今の内容(タイトルなど)であらためて判定し直す
    // (ショート化・配信アーカイブ化・ゲーム判定不可になっていれば取り除く)
    const action = resolveVideoAction(video, channelIdByVideoId[videoId]);
    if (!action.save || action.kind !== "video") {
      deleteIds.push(videoId);
      continue;
    }

    const snippet = video.snippet || {};
    const statistics = video.statistics || {};
    const thumbnails = snippet.thumbnails || {};
    const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || "";

    updateStatements.push(
      env.DB.prepare(
        `UPDATE videos SET title = ?, thumbnail_url = ?, game = ?, view_count = ?, rescreened_at = datetime('now'), updated_at = datetime('now')
         WHERE video_id = ?`
      ).bind(snippet.title || "", thumbnail, action.gameId, Number(statistics.viewCount) || 0, videoId)
    );
  }

  const allStatements = [...updateStatements];
  if (deleteIds.length > 0) {
    allStatements.push(
      env.DB.prepare(
        `DELETE FROM videos WHERE video_id IN (${deleteIds.map(() => "?").join(",")})`
      ).bind(...deleteIds)
    );
  }
  if (allStatements.length > 0) {
    await env.DB.batch(allStatements);
  }
}

// 動画IDの配列を、50件ずつまとめてYouTubeに問い合わせる共通処理(API節約のため)
async function fetchVideosBatched(videoIds, env) {
  const videoMap = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${chunk.join(",")}&key=${env.YOUTUBE_API_KEY}`;
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
// ▼ここから追加:チャンネル登録直後の初回取り込み処理 ============================================
// 役割:チャンネルを登録した直後は、YouTube側から新しい投稿の通知(WebSub)がまだ届いていないため、
//       このままでは「次に何か投稿されるまでトップページに何も表示されない」状態になってしまう。
//       それを防ぐため、登録した瞬間に「直近の動画」と「現在配信中かどうか」をその場で取りに行く。
// ============================================================

const INITIAL_SYNC_VIDEO_COUNT = 10; // 登録直後に取り込む、直近の動画の件数

async function syncChannelInitialContent(channelId, gameId, env) {
  // ※gameId引数は互換性のために残していますが、実際に保存するゲームはタイトルから判定するため使用しません
  // ① チャンネルの「アップロード動画一覧」の場所を取得する(通信1回)
  const channelDetails = await fetchChannelDetailsBatched([channelId], env);
  const ch = channelDetails[0];
  if (!ch) return { synced: 0 };

  const uploadsPlaylistId = (ch.contentDetails.relatedPlaylists || {}).uploads;
  if (!uploadsPlaylistId) return { synced: 0 };

  // ② 直近の動画IDを取得する(通信1回)
  const items = await fetchRecentUploadItems(uploadsPlaylistId, INITIAL_SYNC_VIDEO_COUNT, env);
  const videoIds = items.map(it => it.videoId).filter(Boolean);
  if (videoIds.length === 0) return { synced: 0 };

  // ③ 動画の詳細情報(サムネイル・再生回数・配信中かどうかなど)をまとめて取得する(通信1回)
  const videoMap = await fetchVideosBatched(videoIds, env);

  const statements = [];
  let syncedCount = 0;

  for (const videoId of videoIds) {
    const video = videoMap[videoId];
    if (!video) continue;

    const action = resolveVideoAction(video, channelId);
    if (!action.save) continue; // ショート動画・配信アーカイブ・ゲーム判定不可のいずれかのため取り込まない

    const snippet = video.snippet || {};
    const liveDetails = video.liveStreamingDetails || {};
    const statistics = video.statistics || {};
    const thumbnails = snippet.thumbnails || {};
    const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || "";

    if (action.kind === "live") {
      // 現在配信中の動画 → live_statusに保存
      statements.push(
        env.DB.prepare(
          `INSERT INTO live_status (channel_id, is_live, live_video_id, title, thumbnail_url, viewer_count, game, updated_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(channel_id) DO UPDATE SET
             is_live=1, live_video_id=excluded.live_video_id, title=excluded.title,
             thumbnail_url=excluded.thumbnail_url, viewer_count=excluded.viewer_count,
             game=excluded.game, updated_at=datetime('now')`
        ).bind(channelId, videoId, snippet.title || "", thumbnail, Number(liveDetails.concurrentViewers) || 0, action.gameId)
      );
    } else {
      // 通常の動画 → videosに保存
      statements.push(
        env.DB.prepare(
          `INSERT INTO videos (video_id, channel_id, game, title, thumbnail_url, video_type, published_at, view_count, duration_seconds, rescreened_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'video', ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(video_id) DO UPDATE SET
             game=excluded.game, title=excluded.title, thumbnail_url=excluded.thumbnail_url,
             view_count=excluded.view_count, duration_seconds=excluded.duration_seconds,
             rescreened_at=datetime('now'), updated_at=datetime('now')`
        ).bind(
          videoId,
          channelId,
          action.gameId,
          snippet.title || "",
          thumbnail,
          snippet.publishedAt || "",
          Number(statistics.viewCount) || 0,
          action.durationSeconds
        )
      );
    }
    syncedCount++;
  }

  // ④ まとめて1回の通信で保存する(通信1回)
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return { synced: syncedCount };
}

// アップロード動画一覧(再生リスト)から、直近の動画ID・投稿日を取得する
async function fetchRecentUploadItems(uploadsPlaylistId, maxResults, env) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${maxResults}&playlistId=${uploadsPlaylistId}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(item => ({
    videoId: item.snippet.resourceId ? item.snippet.resourceId.videoId : null,
    publishedAt: item.snippet.publishedAt,
  }));
}

// ============================================================
// ▼ここから追加:チャンネル自動発掘(候補精査)関連の処理 ============================================
// ============================================================

// ゲームごとの検索キーワード
// ※ assets/config.js の GAME_KEYWORDS と同じ内容にしてください(ゲームを追加した場合は両方直す)
const GAME_KEYWORDS = {
  genshin: ["原神", "Genshin", "げんしん", "原神 攻略", "原神 実況", "原神 Vtuber"],
  hsr: ["スターレイル", "崩壊：スターレイル", "崩壊:スターレイル", "HSR", "Honkai: Star Rail", "スターレイル 攻略", "スターレイル 実況", "スターレイル Vtuber"],
  zzz: ["ゼンレスゾーンゼロ", "ゼンゼロ", "ZZZ", "Zenless", "ゼンゼロ 攻略", "ゼンゼロ 実況", "ゼンゼロ Vtuber"],
  ww: ["鳴潮", "めいちょう", "Wuthering Waves", "鳴潮 攻略", "鳴潮 実況", "鳴潮 Vtuber"],
  nte: ["NTE", "NTE 攻略", "NTE 実況", "NTE Vtuber"],
};

// 候補として残すための基準
const CANDIDATE_MIN_SUBSCRIBERS = 100; // 登録者数がこれ未満は除外
const CANDIDATE_ACTIVITY_DAYS = 30; // この日数以内の投稿だけを「直近の投稿」として見る
const CANDIDATE_MIN_RELATED_VIDEOS = 1; // 直近の投稿のうち、ゲーム名が入った動画がこれ未満は除外
const CANDIDATE_MIN_RELATED_JAPANESE = 1; // ↑のうち、日本語(かな含有)がこれ未満は除外
const CANDIDATE_CHECK_VIDEO_COUNT = 50; // 直近の投稿を、何件までさかのぼって確認するか(1回の通信で取得できる上限)

// Cloudflareの「1回の実行につき外部通信50回まで」という上限を超えないための設定
// ※1回の審査処理(processDiscoveryQueueBatch)で扱うチャンネル数の上限
//   計算の目安:1(取得)+1(チャンネル詳細)+この件数分(直近投稿チェック)+1(保存)+1(削除)+1(残り件数確認) < 50
const DISCOVER_PROCESS_BATCH_SIZE = 20;

// 【フェーズA】1つのキーワードで検索し、見つかったチャンネルを「審査待ちの箱」に入れるだけ(通信量は少ない)
// minSubscribers:このチャンネルを審査するときの最低登録者数(未指定なら既定値のCANDIDATE_MIN_SUBSCRIBERSを使う)
// secondaryKeywords:プリセットのキーワードに加えて、審査(関連度判定)のときに一緒に使う副次キーワードの配列
// streamOnly:trueの場合、通常の動画投稿は含めず「配信(ライブのアーカイブ)」だけに絞り込んで検索する
async function queueSearchResults(gameId, keyword, minSubscribers, secondaryKeywords, streamOnly, env) {
  const keywords = GAME_KEYWORDS[gameId];
  if (!keywords) {
    throw new Error(`gameId「${gameId}」のキーワードが見つかりません`);
  }

  const publishedAfter = new Date(
    Date.now() - CANDIDATE_ACTIVITY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // ① 直近1ヶ月の動画(または配信)を検索し、候補チャンネルIDと「最新の関連動画の投稿日」を集める(通信1回)
  const { items, error: searchError } = await searchRecentVideosByKeyword(keyword, publishedAfter, env, streamOnly);
  const found = new Map(); // channelId -> lastRelatedVideoAt
  for (const item of items) {
    const channelId = item.snippet.channelId;
    const publishedAt = item.snippet.publishedAt;
    const existing = found.get(channelId);
    if (!existing || publishedAt > existing) {
      found.set(channelId, publishedAt);
    }
  }

  if (found.size === 0) {
    return { found: 0, queued: 0, error: searchError };
  }

  // ② すでに「本登録済み」「採用済みの候補」「審査待ちの箱に入っている」チャンネルは除外する(通信1回)
  // ※「却下済み(rejected)」のチャンネルはあえて除外しない → 条件を変えて再検索したときに、
  //   もう一度見つかって審査し直せるようにするため(基準を満たせば、却下→審査待ちに戻る)
  const { results: existingRows } = await env.DB.prepare(
    `SELECT channel_id FROM channels
     UNION SELECT channel_id FROM candidate_channels WHERE status != 'rejected'
     UNION SELECT channel_id FROM discovery_queue`
  ).all();
  const existingIds = new Set(existingRows.map(r => r.channel_id));

  const newEntries = [...found.entries()].filter(([channelId]) => !existingIds.has(channelId));
  if (newEntries.length === 0) {
    return { found: found.size, queued: 0 };
  }

  // ③ 新しいチャンネルだけを、まとめて1回の通信で「審査待ちの箱」に入れる(通信1回)
  // ※最低登録者数は指定がなければ既定値、副次キーワードはカンマ区切りの文字列にして保存する
  const minSubscribersValue = Number(minSubscribers) > 0 ? Number(minSubscribers) : CANDIDATE_MIN_SUBSCRIBERS;
  const secondaryKeywordsValue = Array.isArray(secondaryKeywords) ? secondaryKeywords.filter(Boolean).join(",") : "";

  const statements = newEntries.map(([channelId, lastRelatedVideoAt]) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO discovery_queue
        (channel_id, game_id, last_related_video_at, min_subscribers, secondary_keywords)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(channelId, gameId, lastRelatedVideoAt, minSubscribersValue, secondaryKeywordsValue)
  );
  await env.DB.batch(statements);

  return { found: found.size, queued: newEntries.length };
}

// 直近の投稿から、「ゲーム名が入った関連動画」を抜き出して合否を判定する
// ※直近CANDIDATE_ACTIVITY_DAYS日以内の投稿だけを対象にする
// 合格条件:関連動画がCANDIDATE_MIN_RELATED_VIDEOS本以上あり、そのうち日本語(かな含有)がCANDIDATE_MIN_RELATED_JAPANESE本以上
function evaluateGameRelevance(items, keywords) {
  const cutoff = Date.now() - CANDIDATE_ACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  const recentEnough = items.filter(it => {
    const t = new Date(it.publishedAt).getTime();
    return !isNaN(t) && t >= cutoff;
  });
  const relatedItems = recentEnough.filter(it => matchesAnyKeyword(it.title, keywords));
  const relatedCount = relatedItems.length;
  const relatedJapaneseCount = relatedItems.filter(it => containsJapaneseKana(it.title)).length;

  let rejectReason = null;
  if (relatedCount < CANDIDATE_MIN_RELATED_VIDEOS) {
    rejectReason = "not_enough_related_videos";
  } else if (relatedJapaneseCount < CANDIDATE_MIN_RELATED_JAPANESE) {
    rejectReason = "not_enough_japanese";
  }

  return { passes: rejectReason === null, relatedCount, relatedJapaneseCount, rejectReason };
}

// candidate_channelsテーブルへの保存(登録・更新)を1件分組み立てる
// ※採用・却下どちらの場合も同じ形で保存し、reject_reason(却下理由)で区別する
// 　こうしておくことで、「却下済み」タブでも実際の数字・理由を確認できるようにする
function buildCandidateUpsertStatement(env, c) {
  return env.DB.prepare(
    `INSERT INTO candidate_channels
      (channel_id, channel_name, game_id, subscriber_count, relevance_score, japanese_ratio, last_related_video_at, thumbnail_url, status, reject_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET
       channel_name = excluded.channel_name,
       game_id = excluded.game_id,
       subscriber_count = excluded.subscriber_count,
       relevance_score = excluded.relevance_score,
       japanese_ratio = excluded.japanese_ratio,
       last_related_video_at = excluded.last_related_video_at,
       thumbnail_url = excluded.thumbnail_url,
       status = excluded.status,
       reject_reason = excluded.reject_reason,
       discovered_at = datetime('now')`
  ).bind(
    c.channelId, c.channelName, c.gameId, c.subscriberCount,
    c.relatedCount, c.relatedJapaneseCount, c.lastRelatedVideoAt, c.thumbnail,
    c.status, c.rejectReason
  );
}

// 【フェーズB】「審査待ちの箱」から少しずつ(規定件数まで)取り出して、登録者数・関連動画の本数を審査する
async function processDiscoveryQueueBatch(env) {
  // ① 箱の中から、古い順に規定件数だけ取り出す(通信1回)
  const { results: batch } = await env.DB.prepare(
    "SELECT * FROM discovery_queue ORDER BY queued_at ASC LIMIT ?"
  )
    .bind(DISCOVER_PROCESS_BATCH_SIZE)
    .all();

  if (batch.length === 0) {
    return { processed: 0, added: 0, remaining: 0 };
  }

  // ② 取り出した分のチャンネル詳細(登録者数など)を、まとめて1回の通信で取得する(通信1回、最大50件まで対応)
  const channelIds = batch.map(row => row.channel_id);
  const channelDetails = await fetchChannelDetailsBatched(channelIds, env);
  const detailsMap = new Map(channelDetails.map(ch => [ch.id, ch]));

  // ③ 1件ずつ、登録者数→直近の関連動画の順にチェックする(通信は該当件数分)
  //    合格・不合格に関わらず、必ず結果を保存する(却下の場合は理由も一緒に残す)
  const statements = [];
  let addedCount = 0;

  for (const row of batch) {
    const ch = detailsMap.get(row.channel_id);

    if (!ch) {
      // YouTube側にチャンネル情報が見つからない(削除済み・非公開・IDが無効など)
      statements.push(buildCandidateUpsertStatement(env, {
        channelId: row.channel_id, channelName: "", gameId: row.game_id,
        subscriberCount: 0, relatedCount: 0, relatedJapaneseCount: 0,
        lastRelatedVideoAt: row.last_related_video_at, thumbnail: "",
        status: "rejected", rejectReason: "not_found_on_youtube",
      }));
      continue;
    }

    const channelName = ch.snippet.title || "";
    const thumbnails = ch.snippet.thumbnails || {};
    const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || "";

    // このチャンネルを検索したときに指定した最低登録者数(未指定なら既定値)で判定する
    const minSubscribers = Number(row.min_subscribers) > 0 ? Number(row.min_subscribers) : CANDIDATE_MIN_SUBSCRIBERS;
    const subscriberCount = Number(ch.statistics.subscriberCount) || 0;
    if (subscriberCount < minSubscribers) {
      statements.push(buildCandidateUpsertStatement(env, {
        channelId: row.channel_id, channelName, gameId: row.game_id,
        subscriberCount, relatedCount: 0, relatedJapaneseCount: 0,
        lastRelatedVideoAt: row.last_related_video_at, thumbnail,
        status: "rejected", rejectReason: "low_subscribers",
      }));
      continue;
    }

    const uploadsPlaylistId = (ch.contentDetails.relatedPlaylists || {}).uploads;
    if (!uploadsPlaylistId) {
      statements.push(buildCandidateUpsertStatement(env, {
        channelId: row.channel_id, channelName, gameId: row.game_id,
        subscriberCount, relatedCount: 0, relatedJapaneseCount: 0,
        lastRelatedVideoAt: row.last_related_video_at, thumbnail,
        status: "rejected", rejectReason: "no_uploads_playlist",
      }));
      continue;
    }

    // プリセットのキーワードに、検索時に指定した副次キーワードを合わせて関連動画を判定する
    const extraKeywords = (row.secondary_keywords || "")
      .split(",")
      .map(k => k.trim())
      .filter(Boolean);
    const keywords = [...(GAME_KEYWORDS[row.game_id] || []), ...extraKeywords];
    const recentItems = await fetchRecentUploadTitles(uploadsPlaylistId, CANDIDATE_CHECK_VIDEO_COUNT, env);
    const evaluation = evaluateGameRelevance(recentItems, keywords);

    statements.push(buildCandidateUpsertStatement(env, {
      channelId: row.channel_id, channelName, gameId: row.game_id,
      subscriberCount, relatedCount: evaluation.relatedCount, relatedJapaneseCount: evaluation.relatedJapaneseCount,
      lastRelatedVideoAt: row.last_related_video_at, thumbnail,
      status: evaluation.passes ? "pending" : "rejected",
      rejectReason: evaluation.passes ? null : evaluation.rejectReason,
    }));
    if (evaluation.passes) addedCount++;
  }

  // ④ 審査結果を、まとめて1回の通信で保存する(通信1回)
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  // ⑤ 今回審査した分は、合否に関わらず箱から取り除く(通信1回)
  await env.DB.prepare(
    `DELETE FROM discovery_queue WHERE channel_id IN (${channelIds.map(() => "?").join(",")})`
  )
    .bind(...channelIds)
    .run();

  // ⑥ 箱にまだ残っている件数を確認する(通信1回)
  const { results: remainRows } = await env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM discovery_queue"
  ).all();
  const remaining = remainRows[0] ? remainRows[0].cnt : 0;

  return { processed: batch.length, added: addedCount, remaining };
}

// キーワードで、直近の動画を検索する(YouTube search API)
// streamOnly:trueの場合、通常の動画投稿は含めず「配信(ライブのアーカイブ)」だけに絞り込んで検索する
//   (YouTube側のeventType=completedを指定。すでに終わったライブ配信のみが対象になる)
// 1回のキーワード検索につき、何ページ分(50件×ページ数)を見に行くか
// ※人気のあるキーワードだと1ヶ月で50件を超える投稿があり、新しい50件の裏に隠れて
//   見つからなくなるチャンネルがあるため、複数ページ分をまとめて見に行くようにしている
const SEARCH_PAGES_PER_KEYWORD = 3; // 50件 × 3ページ = 最大150件まで

async function searchRecentVideosByKeyword(keyword, publishedAfter, env, streamOnly) {
  const allItems = [];
  let pageToken = "";
  let apiError = null; // エラーが起きた場合、その内容をここに入れて呼び出し元に伝える

  for (let page = 0; page < SEARCH_PAGES_PER_KEYWORD; page++) {
    const apiUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=50` +
      `&publishedAfter=${encodeURIComponent(publishedAfter)}&q=${encodeURIComponent(keyword)}` +
      (streamOnly ? `&eventType=completed` : ``) +
      `&key=${env.YOUTUBE_API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : "");

    const res = await fetch(apiUrl);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[AstralHub] YouTube検索APIでエラーが発生しました", keyword, res.status, errBody);
      apiError = `YouTube検索でエラーが発生しました(status: ${res.status})。1日の利用上限に達している可能性があります。`;
      break;
    }
    const data = await res.json();
    allItems.push(...(data.items || []));

    if (!data.nextPageToken) break; // これ以上ページがなければ終了
    pageToken = data.nextPageToken;
  }

  return { items: allItems, error: apiError };
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

// アップロード動画一覧(再生リスト)から、直近の動画のタイトル・投稿日をまとめて取得する
async function fetchRecentUploadTitles(uploadsPlaylistId, maxResults, env) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${maxResults}&playlistId=${uploadsPlaylistId}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(item => ({
    title: item.snippet.title || "",
    publishedAt: item.snippet.publishedAt || "",
  }));
}

// タイトルに、ひらがな・カタカナが含まれているか判定する(日本語チャンネルかどうかの目印として使う)
function containsJapaneseKana(title) {
  // ひらがな:\u3040-\u309F、カタカナ:\u30A0-\u30FF(長音符ーなどを含む)
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(title);
}

// タイトルが、指定したキーワードのどれかを含んでいるか判定する
function matchesAnyKeyword(title, keywords) {
  const lowerTitle = title.toLowerCase();
  return keywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

// 「却下済み」の候補を、今の基準でもう一度見直す
// (基準を緩めたときに、それまで弾かれていたチャンネルにもう一度チャンスを与えるための機能)
// 今の基準を満たすようになっていれば、却下→審査待ちに戻す。満たさなければ、理由を更新して却下のまま残す。
// beforeは「今回の見直し作業を始めた時刻」。この時刻より前に見直された候補だけを対象にすることで、
// 見直し済みのチャンネルを何度も処理し直してしまう(処理が終わらなくなる)のを防いでいる。
async function rescreenPendingCandidates(env, before) {
  const batchSize = DISCOVER_PROCESS_BATCH_SIZE;
  const cutoff = before || new Date().toISOString();

  // ① 却下済みの候補を、見直しがまだ済んでいないものから順に規定件数だけ取り出す(通信1回)
  const { results: batch } = await env.DB.prepare(
    `SELECT * FROM candidate_channels
     WHERE status = 'rejected' AND discovered_at < ?
     ORDER BY discovered_at ASC LIMIT ?`
  )
    .bind(cutoff, batchSize)
    .all();

  if (batch.length === 0) {
    return { processed: 0, kept: 0, rejected: 0, remaining: 0 };
  }

  // ② チャンネル詳細を、まとめて1回の通信で取得し直す(通信1回)
  const channelIds = batch.map(row => row.channel_id);
  const channelDetails = await fetchChannelDetailsBatched(channelIds, env);
  const detailsMap = new Map(channelDetails.map(ch => [ch.id, ch]));

  const statements = [];
  let keptCount = 0;
  let rejectedCount = 0;

  for (const row of batch) {
    const ch = detailsMap.get(row.channel_id);

    if (!ch) {
      statements.push(buildCandidateUpsertStatement(env, {
        channelId: row.channel_id, channelName: row.channel_name || "", gameId: row.game_id,
        subscriberCount: 0, relatedCount: 0, relatedJapaneseCount: 0,
        lastRelatedVideoAt: row.last_related_video_at, thumbnail: row.thumbnail_url || "",
        status: "rejected", rejectReason: "not_found_on_youtube",
      }));
      rejectedCount++;
      continue;
    }

    const channelName = ch.snippet.title || row.channel_name || "";
    const thumbnails = ch.snippet.thumbnails || {};
    const thumbnail = (thumbnails.medium || thumbnails.high || thumbnails.default || {}).url || row.thumbnail_url || "";
    const subscriberCount = Number(ch.statistics.subscriberCount) || 0;

    if (subscriberCount < CANDIDATE_MIN_SUBSCRIBERS) {
      statements.push(buildCandidateUpsertStatement(env, {
        channelId: row.channel_id, channelName, gameId: row.game_id,
        subscriberCount, relatedCount: 0, relatedJapaneseCount: 0,
        lastRelatedVideoAt: row.last_related_video_at, thumbnail,
        status: "rejected", rejectReason: "low_subscribers",
      }));
      rejectedCount++;
      continue;
    }

    const uploadsPlaylistId = (ch.contentDetails.relatedPlaylists || {}).uploads;
    if (!uploadsPlaylistId) {
      statements.push(buildCandidateUpsertStatement(env, {
        channelId: row.channel_id, channelName, gameId: row.game_id,
        subscriberCount, relatedCount: 0, relatedJapaneseCount: 0,
        lastRelatedVideoAt: row.last_related_video_at, thumbnail,
        status: "rejected", rejectReason: "no_uploads_playlist",
      }));
      rejectedCount++;
      continue;
    }

    const keywords = GAME_KEYWORDS[row.game_id] || [];
    const recentItems = await fetchRecentUploadTitles(uploadsPlaylistId, CANDIDATE_CHECK_VIDEO_COUNT, env);
    const evaluation = evaluateGameRelevance(recentItems, keywords);

    statements.push(buildCandidateUpsertStatement(env, {
      channelId: row.channel_id, channelName, gameId: row.game_id,
      subscriberCount, relatedCount: evaluation.relatedCount, relatedJapaneseCount: evaluation.relatedJapaneseCount,
      lastRelatedVideoAt: row.last_related_video_at, thumbnail,
      status: evaluation.passes ? "pending" : "rejected",
      rejectReason: evaluation.passes ? null : evaluation.rejectReason,
    }));

    if (evaluation.passes) keptCount++;
    else rejectedCount++;
  }

  // ③ 判定結果を、まとめて1回の通信で反映する(通信1回)
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  // ④ まだ見直しが必要な件数を確認する(通信1回)
  const { results: remainRows } = await env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM candidate_channels WHERE status = 'rejected' AND discovered_at < ?"
  )
    .bind(cutoff)
    .all();
  const remaining = remainRows[0] ? remainRows[0].cnt : 0;

  return { processed: batch.length, kept: keptCount, rejected: rejectedCount, remaining };
}
