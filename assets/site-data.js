/**
 * AstralHub 共通データ処理ファイル
 * index.html / list.html / article.html から読み込まれる。
 * サンプルデータ・localStorageからの読み込み・カード描画のHTML生成など、
 * 「データをどう扱うか」に関する処理をここにまとめている。
 * 表示に関わる状態（フィルターの選択状態など）は各ページ側で管理する。
 */
(function () {
  const { CATEGORY_LABEL, STORAGE_KEYS } = window.ASTRA_CONFIG;

  // ※以下はすべてサンプル（ダミー）データです。管理画面でデータを登録すると自動的にこちらは表示されなくなります。
  const SAMPLE_NEWS = [
    { id:'sample-news-1', game:'genshin', cat:'character',   title:'[サンプル] 新キャラクター「ドゥリン」公開', summary:'[サンプル] 原神の公式Xにて、新キャラクター「ドゥリン」が発表されました。詳しい実装時期は続報をお待ちください。', url:'', minutesAgo: 2 },
    { id:'sample-news-2', game:'hsr',     cat:'version',     title:'[サンプル] Ver.2.3「さよなら、ピノコニー」予告', summary:'[サンプル] 崩壊：スターレイルの次期バージョン「さよなら、ピノコニー」の予告が公開されました。', url:'', minutesAgo: 15 },
    { id:'sample-news-3', game:'zzz',     cat:'stream',      title:'[サンプル] Ver.1.5 予告番組まとめ', summary:'[サンプル] ゼンレスゾーンゼロの予告番組の内容がまとめられています。', url:'', minutesAgo: 60 },
    { id:'sample-news-4', game:'ww',      cat:'version',     title:'[サンプル] Ver.2.0「静寂の黎明」紹介', summary:'[サンプル] 鳴潮の新バージョン「静寂の黎明」の見どころが紹介されています。', url:'', minutesAgo: 120 },
    { id:'sample-news-5', game:'nte',     cat:'event',       title:'[サンプル] クローズドβテスト募集開始', summary:'[サンプル] NTEのクローズドβテスト参加者の募集が始まりました。', url:'', minutesAgo: 180 },
    { id:'sample-news-6', game:'genshin', cat:'maintenance', title:'[サンプル] 臨時メンテナンスのお知らせ', summary:'[サンプル] 原神にて臨時メンテナンスが実施される予定です。', url:'', minutesAgo: 240 },
  ];
  const SAMPLE_LIVE = [
    { id:'sample-live-1', game:'genshin', title:'[サンプル] Ver.6.2 予告番組視聴枠', channel:'原神公式', viewers: 12345 },
    { id:'sample-live-2', game:'hsr',     title:'[サンプル] 開拓ラジオ 特別放送', channel:'崩壊：スターレイル公式', viewers: 8705 },
    { id:'sample-live-3', game:'zzz',     title:'[サンプル] 新エリー都へようこそ！', channel:'ZZZ公式', viewers: 6549 },
    { id:'sample-live-4', game:'ww',      title:'[サンプル] Ver.2.0 特別通信', channel:'鳴潮公式', viewers: 3210 },
    { id:'sample-live-5', game:'nte',     title:'[サンプル] 探索テスト 配信中！', channel:'NTE公式', viewers: 2111 },
  ];
  const SAMPLE_VIDEOS = [
    { id:'sample-video-1', game:'genshin', title:'[サンプル] Ver.6.2で絶対やるべきこと5選', channel:'原神公式', views: 287000, duration:'5:24', minutesAgo: 40 },
    { id:'sample-video-2', game:'hsr',     title:'[サンプル] 2.3速報！新キャラの性能解説', channel:'スターレイル攻略ch', views: 213000, duration:'3:40', minutesAgo: 90 },
    { id:'sample-video-3', game:'zzz',     title:'[サンプル] 新キャラ性能解説｜おすすめ編成', channel:'ZZZ攻略部', views: 189000, duration:'6:18', minutesAgo: 130 },
    { id:'sample-video-4', game:'ww',      title:'[サンプル] キャラ完全解説｜おすすめ武器・編成', channel:'鳴潮研究所', views: 124000, duration:'4:57', minutesAgo: 220 },
    { id:'sample-video-5', game:'nte',     title:'[サンプル] NTEの世界を10分で紹介', channel:'NTE公式', views: 98000, duration:'3:33', minutesAgo: 300 },
  ];

  function sampleToTimestamped(list){
    const now = Date.now();
    return list.map(item => {
      const minutesAgo = typeof item.minutesAgo === 'number' ? item.minutesAgo : 0;
      return { ...item, publishedAt: new Date(now - minutesAgo * 60000).toISOString() };
    });
  }

  function loadList(storageKey, sample){
    try {
      const raw = localStorage.getItem(storageKey);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch (e) { /* 保存データが壊れている場合はサンプルにフォールバック */ }
    return sampleToTimestamped(sample);
  }

  function loadChannelLedger(){
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.channels);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function gameById(id){ return window.ASTRA_CONFIG.GAMES.find(g => g.id === id); }

  function timeAgoLabel(publishedAt){
    const min = Math.max(0, Math.floor((Date.now() - new Date(publishedAt).getTime()) / 60000));
    if (min < 60) return min + '分前';
    const h = Math.floor(min/60);
    if (h < 24) return h + '時間前';
    return Math.floor(h/24) + '日前';
  }

  function thumbStyle(g){
    return `background: linear-gradient(135deg, ${g.color}, ${g.color}99);`;
  }

  function emptyHtml(msg){
    return `<div class="empty-state">${msg || '該当する情報がありません。ゲームフィルターの選択をご確認ください。'}</div>`;
  }

  // ゲームアイコン画像。読み込みに失敗した場合はテキスト表示に自動で切り替わる。
  function gameIconImgHtml(g, sizeClass){
    return `<img src="${g.icon}" alt="${g.name}" class="game-icon ${sizeClass || ''}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'game-icon-fallback ${sizeClass || ''}',textContent:'${g.name.slice(0,2)}'}))">`;
  }

  function liveCardHtml(item){
    const g = gameById(item.game);
    const thumbInner = item.thumbnail
      ? `<img class="media-thumb-img" src="${item.thumbnail}" alt="">`
      : gameIconImgHtml(g, 'icon-md');
    const thumbTag = item.url ? 'a' : 'div';
    const thumbLinkAttrs = item.url ? ` href="${item.url}" target="_blank" rel="noopener noreferrer"` : '';
    return `<div class="media-card">
      <${thumbTag} class="media-thumb landscape" style="${thumbStyle(g)}"${thumbLinkAttrs}>
        <span class="badge-viewers">🔥 ${item.viewers.toLocaleString()}</span>
        ${thumbInner}
      </${thumbTag}>
      <div class="card-tag-row"><span class="tag" style="background:${g.color}">${g.name}</span></div>
      <p class="card-title">${item.title}</p>
      <div class="card-meta"><span>${item.channel}</span></div>
    </div>`;
  }

  function videoCardHtml(item){
    const g = gameById(item.game);
    const thumbInner = item.thumbnail
      ? `<img class="media-thumb-img" src="${item.thumbnail}" alt="">`
      : gameIconImgHtml(g, 'icon-md');
    const thumbTag = item.url ? 'a' : 'div';
    const thumbLinkAttrs = item.url ? ` href="${item.url}" target="_blank" rel="noopener noreferrer"` : '';
    return `<div class="media-card">
      <${thumbTag} class="media-thumb landscape" style="${thumbStyle(g)}"${thumbLinkAttrs}>
        <span class="badge-duration">${item.duration}</span>
        ${thumbInner}
      </${thumbTag}>
      <div class="card-tag-row"><span class="tag" style="background:${g.color}">${g.name}</span></div>
      <p class="card-title">${item.title}</p>
      <div class="card-meta"><span>${item.channel}</span><span>${item.views.toLocaleString()}回視聴</span></div>
    </div>`;
  }

  function newsItemHtml(item){
    const g = gameById(item.game);
    const inner = `
      <div class="news-body">
        <div class="card-tag-row">
          <span class="tag" style="background:${g.color}">${g.name}</span>
          <span class="tag tag-cat">${CATEGORY_LABEL[item.cat]}</span>
        </div>
        <p class="news-title">${item.title}</p>
        <span class="news-time">${timeAgoLabel(item.publishedAt)}</span>
      </div>
      <div class="news-thumb" style="${thumbStyle(g)}">${gameIconImgHtml(g, 'icon-sm')}</div>
    `;
    if (item.id) {
      return `<a class="news-item" href="article.html?id=${encodeURIComponent(item.id)}">${inner}</a>`;
    }
    return `<div class="news-item">${inner}</div>`;
  }

  // 管理画面（admin.html）の「チャンネル台帳」で"blocked"に設定されたチャンネルを除外する。
  // 自動取得（youtube-auto）データには channelId が入っているので、原則こちらで厳密に一致させる。
  // 手動で登録した古いデータ（channelIdを持たない）は、念のためチャンネル名でも一致を見る。
  function getFilteredData(activeGameIds){
    const news = loadList(STORAGE_KEYS.news, SAMPLE_NEWS);
    const live = loadList(STORAGE_KEYS.live, SAMPLE_LIVE);
    const videos = loadList(STORAGE_KEYS.videos, SAMPLE_VIDEOS);
    const ledger = loadChannelLedger();
    const blockedIds = new Set(ledger.filter(c => c.blocked === 'block' && c.channelId).map(c => c.channelId));
    const blockedNames = new Set(ledger.filter(c => c.blocked === 'block' && !c.channelId).map(c => c.channel));

    function passesChannelRules(item){
      if (item.channelId && blockedIds.has(item.channelId)) return false;
      if (blockedNames.has(item.channel)) return false;
      return true;
    }

    const activeSet = new Set(activeGameIds);
    return {
      news: news.filter(n => activeSet.has(n.game)),
      live: live.filter(v => activeSet.has(v.game) && passesChannelRules(v)),
      videos: videos.filter(v => activeSet.has(v.game) && passesChannelRules(v)),
    };
  }

  // 記事ページ(article.html)用：フィルターに関係なく、IDから該当ニュース1件を探す
  function findNewsById(id){
    const news = loadList(STORAGE_KEYS.news, SAMPLE_NEWS);
    return news.find(n => n.id === id) || null;
  }

  // ▼ここから追加：YouTube自動取得機能（チャンネル指定方式） ============================================
  // 役割：config.js の YOUTUBE_CHANNELS に登録されたチャンネルひとつひとつについて、
  //       ①「今まさにLIVE配信中か」を search API でピンポイントに確認する
  //       ②「アップロード一覧（Playlists API）」から通常動画（ショート・アーカイブを除く）を取得する
  //       という2つの処理を行い、STORAGE_KEYS.live / STORAGE_KEYS.videos に保存する。
  //
  //       【重要・修正メモ】YouTubeの仕様上、配信中のLIVE動画は「配信が終わってアーカイブになるまで」
  //       アップロード一覧（Playlists API）には出てきません。そのため、LIVE検知だけは
  //       search API（type=video&eventType=live）で別途確認する必要があります。
  //       search APIは他のAPIより消費（クォータ）が大きいため、通常動画の取得には使わず
  //       「LIVE検知」の用途だけに限定して使っています。

  const YT_LAST_FETCH_KEY = 'astra_youtube_last_fetch'; // 最後に取得した時刻を覚えておく

  async function ytFetchJson(url){
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error('YouTube APIエラー: ' + res.status + ' ' + body);
    }
    return res.json();
  }

  // 配列を指定した個数ずつのグループに分割する（YouTube APIは一度に最大50件までしか指定できないため）
  function chunkArray(arr, size){
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ISO8601形式の動画時間（例: "PT4M13S"）を秒数に変換する
  function ytDurationToSeconds(iso){
    const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    return (parseInt(m[1]||'0',10) * 3600) + (parseInt(m[2]||'0',10) * 60) + parseInt(m[3]||'0',10);
  }

  // ISO8601形式の動画時間を "4:13" のような表示用の文字列に変換する
  function ytFormatDuration(iso){
    const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    const mm = h > 0 ? String(min).padStart(2, '0') : String(min);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // 登録された各チャンネルの「アップロード一覧プレイリストID」をまとめて取得する（channels.list、最大50件ずつ）
  // これを使うことで、チャンネルごとに個別リクエストを送るより消費を抑えられる
  async function ytFetchUploadsPlaylistIds(channelIds, apiKey){
    const map = new Map(); // channelId -> uploadsPlaylistId
    for (const chunk of chunkArray(channelIds, 50)) {
      const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chunk.join(',')}&key=${apiKey}`;
      const data = await ytFetchJson(url);
      (data.items || []).forEach(ch => {
        const uploads = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
        if (uploads) map.set(ch.id, uploads);
      });
    }
    return map;
  }

  // 指定したプレイリスト（＝あるチャンネルのアップロード一覧）から、最新の動画を取得する
  async function ytFetchPlaylistItems(playlistId, apiKey, maxResults){
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${maxResults || 5}&key=${apiKey}`;
    const data = await ytFetchJson(url);
    return data.items || [];
  }

  // ★新規追加：指定したチャンネルが「今まさにLIVE配信中」かどうかをピンポイントで確認する
  // アップロード一覧には出てこない「配信中」の動画を見つけるための唯一の確実な方法（search API）
  // 通常は0件（配信していない）か1件（配信中）が返る
  async function ytFetchLiveVideoIds(channelId, apiKey){
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
    const data = await ytFetchJson(url);
    return (data.items || []).map(item => item.id && item.id.videoId).filter(Boolean);
  }

  // 動画IDの一覧から、再生回数・動画の長さ・同時視聴者数・LIVE状態などの詳細情報をまとめて取得する（最大50件ずつ）
  async function ytFetchVideoDetails(videoIds, apiKey){
    if (videoIds.length === 0) return [];
    const all = [];
    for (const chunk of chunkArray(videoIds, 50)) {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${chunk.join(',')}&key=${apiKey}`;
      const data = await ytFetchJson(url);
      all.push(...(data.items || []));
    }
    return all;
  }

  // サムネイルの縦横サイズを取得する（アスペクト比の判定に使う）
  function ytGetThumbSize(detail){
    const thumbs = detail && detail.snippet && detail.snippet.thumbnails;
    const t = thumbs && (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default);
    return (t && t.width && t.height) ? { width: t.width, height: t.height } : null;
  }

  // YouTubeショートの判定：config.js の SHORTS_FILTER.MAX_DURATION_SECONDS（既定3分）以下で、
  // かつ縦長・正方形の動画をショート扱いとする。サムネイルの縦横が取得できない場合は60秒以下のみ対象とする（安全側）
  function ytIsShort(detail){
    const iso = detail && detail.contentDetails && detail.contentDetails.duration;
    if (!iso) return false;
    const totalSeconds = ytDurationToSeconds(iso);
    const shortsConf = window.ASTRA_CONFIG.SHORTS_FILTER || {};
    const maxShortSeconds = typeof shortsConf.MAX_DURATION_SECONDS === 'number' ? shortsConf.MAX_DURATION_SECONDS : 180;
    if (totalSeconds <= 0 || totalSeconds > maxShortSeconds) return false;

    const size = ytGetThumbSize(detail);
    if (size) return size.height >= size.width; // 縦長・正方形ならショート

    return totalSeconds <= 60;
  }

  // 「配信中」かどうかは、動画詳細のliveBroadcastContentで確認する
  // （プレミア公開など、紛らわしいものを「配信中」と誤判定しないようにするため）
  function ytIsCurrentlyLive(detail){
    return !!(detail && detail.snippet && detail.snippet.liveBroadcastContent === 'live');
  }

  // 過去に配信されたアーカイブ（配信が終わったもの）かどうかを判定する
  // liveStreamingDetailsは「配信（今もこれからも含む）だった動画」に必ず付くため、これがあれば配信系とみなす
  function ytIsBroadcastVideo(detail){
    return !!(detail && detail.liveStreamingDetails);
  }

  // 取得したYouTubeのデータを、AstralHubのカードがそのまま読める形に変換する
  // source: 'youtube-auto' は「自動取得したデータ」の目印
  // channelId: 管理画面でのブロック設定に使う
  // url: サムネイルクリックで実際の配信・動画ページへ飛べるようにするためのリンク先
  // LIVEカード用のデータを組み立てる（search APIで見つけた videoId と、videos APIで取得した詳細情報から作る）
  function ytBuildLiveItem(chConf, videoId, detail){
    const snippet = detail.snippet || {};
    return {
      id: videoId,
      game: chConf.gameId,
      source: 'youtube-auto',
      channelId: chConf.channelId,
      url: 'https://www.youtube.com/watch?v=' + videoId,
      title: snippet.title || '',
      channel: snippet.channelTitle || chConf.label || '',
      thumbnail: (snippet.thumbnails && (snippet.thumbnails.medium || snippet.thumbnails.default) || {}).url || '',
      viewers: (detail.liveStreamingDetails && detail.liveStreamingDetails.concurrentViewers)
        ? parseInt(detail.liveStreamingDetails.concurrentViewers, 10) : 0,
    };
  }

  function ytBuildVideoItem(chConf, playlistItem, detail){
    const videoId = playlistItem.snippet.resourceId.videoId;
    return {
      id: videoId,
      game: chConf.gameId,
      source: 'youtube-auto',
      channelId: chConf.channelId,
      url: 'https://www.youtube.com/watch?v=' + videoId,
      title: playlistItem.snippet.title,
      channel: playlistItem.snippet.channelTitle,
      thumbnail: (playlistItem.snippet.thumbnails && (playlistItem.snippet.thumbnails.medium || playlistItem.snippet.thumbnails.default) || {}).url || '',
      views: (detail.statistics && detail.statistics.viewCount) ? parseInt(detail.statistics.viewCount, 10) : 0,
      duration: (detail.contentDetails && detail.contentDetails.duration) ? ytFormatDuration(detail.contentDetails.duration) : '',
      publishedAt: playlistItem.snippet.publishedAt,
    };
  }

  // config.js の YOUTUBE_CHANNELS に登録された全チャンネル分、YouTubeからデータを取得してlocalStorageに保存する
  // 「ショート動画」と「配信済みアーカイブ」は動画欄から除外し、配信中のものだけをLIVE欄に載せる
  // index.html / list.html の読み込み時に1回呼び出す想定
  async function refreshYouTubeData(){
    const apiKey = window.ASTRA_CONFIG.YOUTUBE_API_KEY;
    const channelList = window.ASTRA_CONFIG.YOUTUBE_CHANNELS || [];
    const cacheConf = window.ASTRA_CONFIG.CACHE_MINUTES || {};
    // LIVEのリアルタイム性を優先するため、既定では live のキャッシュ分数（通常0分＝毎回確認）を基準にする
    const throttleMinutes = typeof cacheConf.live === 'number' ? cacheConf.live : 0;

    if (!apiKey || apiKey.indexOf('ここに') === 0) {
      console.warn('[AstralHub] YouTube APIキーが未設定のため、自動取得はスキップされました。');
      return false;
    }
    if (channelList.length === 0) {
      console.warn('[AstralHub] config.js の YOUTUBE_CHANNELS が空のため、自動取得はスキップされました。');
      return false;
    }

    // 前回の取得から一定時間が経っていなければ何もしない（APIの上限を使い切らないための安全弁）
    const lastFetch = parseInt(localStorage.getItem(YT_LAST_FETCH_KEY) || '0', 10);
    if (Date.now() - lastFetch < throttleMinutes * 60000) {
      console.log('[AstralHub][調査] 前回の取得から時間が経っていないため、今回はスキップされました（' + throttleMinutes + '分待つと再取得します）');
      return false;
    }

    try {
      const channelIds = channelList.map(c => c.channelId).filter(Boolean);
      const uploadsMap = await ytFetchUploadsPlaylistIds(channelIds, apiKey);

      // ① 各チャンネルについて「今まさにLIVE配信中か」を確認する（search API・LIVE検知専用）
      const liveCheckResults = await Promise.all(channelList.map(async (chConf) => {
        if (!chConf.channelId) return [];
        try {
          const videoIds = await ytFetchLiveVideoIds(chConf.channelId, apiKey);
          // ▼調査用ログ（原因特定のための一時的なものです。解決したら削除してOKです）
          console.log('[AstralHub][調査] チャンネル「' + (chConf.label || chConf.channelId) + '」のLIVE検索結果:', videoIds.length + '件', videoIds);
          return videoIds.map(videoId => ({ videoId, chConf }));
        } catch (e) {
          console.error('[AstralHub] LIVE確認に失敗しました（チャンネル: ' + (chConf.label || chConf.channelId) + '）', e);
          return [];
        }
      }));
      const flatLiveCandidates = liveCheckResults.flat();

      // ② 各チャンネルの「アップロード一覧」から、通常動画の候補を取得する（Playlists API＝消費が少ない）
      const perChannelVideoResults = await Promise.all(channelList.map(async (chConf) => {
        const uploadsPlaylistId = uploadsMap.get(chConf.channelId);
        if (!uploadsPlaylistId) {
          console.warn('[AstralHub] チャンネルが見つかりませんでした（channelIdをご確認ください）: ' + (chConf.label || chConf.channelId));
          return [];
        }
        try {
          const items = await ytFetchPlaylistItems(uploadsPlaylistId, apiKey, 5);
          return items.map(playlistItem => ({ playlistItem, chConf }));
        } catch (e) {
          console.error('[AstralHub] プレイリスト取得に失敗しました（チャンネル: ' + (chConf.label || chConf.channelId) + '）', e);
          return [];
        }
      }));
      const flatVideoItems = perChannelVideoResults.flat();

      // ③ LIVE候補・通常動画候補、両方の動画IDをまとめて詳細確認する（videos APIはまとめて呼べるので節約できる）
      const liveVideoIds = flatLiveCandidates.map(x => x.videoId);
      const normalVideoIds = flatVideoItems.map(x => x.playlistItem.snippet.resourceId.videoId).filter(Boolean);
      const allVideoIds = Array.from(new Set([...liveVideoIds, ...normalVideoIds]));
      const details = await ytFetchVideoDetails(allVideoIds, apiKey);
      const detailById = new Map(details.map(d => [d.id, d]));

      const allLive = [];
      const allVideos = [];
      const usedLiveVideoIds = new Set();

      // LIVE欄を組み立てる（search APIで「配信中」と確認できたものだけを対象にする）
      flatLiveCandidates.forEach(({ videoId, chConf }) => {
        const detail = detailById.get(videoId);
        // ▼調査用ログ
        console.log('[AstralHub][調査] videoId=' + videoId + ' の詳細:',
          detail ? { liveBroadcastContent: detail.snippet && detail.snippet.liveBroadcastContent } : '詳細が取得できませんでした（detailがありません）');
        if (!detail) return;
        if (!ytIsCurrentlyLive(detail)) { console.log('[AstralHub][調査] → 二重チェックでliveと判定されず除外されました'); return; } // 念のため二重チェック（確認直後に配信が終わった場合など）
        allLive.push(ytBuildLiveItem(chConf, videoId, detail));
        usedLiveVideoIds.add(videoId);
      });

      // 通常動画欄を組み立てる（LIVE欄に入ったもの・アーカイブ・ショートは除外する）
      flatVideoItems.forEach(({ playlistItem, chConf }) => {
        const videoId = playlistItem.snippet.resourceId.videoId;
        if (usedLiveVideoIds.has(videoId)) return; // LIVE欄に入っているものは動画欄に重複させない
        const detail = detailById.get(videoId);
        if (!detail) return;
        if (ytIsBroadcastVideo(detail)) return; // 配信が終わったアーカイブは「動画」欄に載せない
        if (ytIsShort(detail)) return; // ショート動画は除外

        allVideos.push(ytBuildVideoItem(chConf, playlistItem, detail));
      });

      // ▼調査用ログ（最終結果）
      console.log('[AstralHub][調査] 最終的にLIVE欄に入った件数:', allLive.length, allLive);

      localStorage.setItem(STORAGE_KEYS.live, JSON.stringify(allLive));
      localStorage.setItem(STORAGE_KEYS.videos, JSON.stringify(allVideos));
      localStorage.setItem(YT_LAST_FETCH_KEY, String(Date.now()));
      return true;
    } catch (e) {
      console.error('[AstralHub] YouTubeデータの取得に失敗しました', e);
      return false;
    }
  }

  // 「最終更新はいつか」をHTML側で表示するための情報を返す
  function getYoutubeUpdateInfo(){
    const cacheConf = (window.ASTRA_CONFIG && window.ASTRA_CONFIG.CACHE_MINUTES) || {};
    let lastFetchAt = null;
    try {
      const v = localStorage.getItem(YT_LAST_FETCH_KEY);
      lastFetchAt = v ? parseInt(v, 10) : null;
    } catch (e) { /* 無視 */ }
    return {
      lastFetchAt,
      liveCacheMinutes: typeof cacheConf.live === 'number' ? cacheConf.live : 0,
      videoCacheMinutes: typeof cacheConf.videos === 'number' ? cacheConf.videos : 0,
    };
  }
  // ▲ここまで追加 ============================================

  window.ASTRA_DATA = {
    gameById, timeAgoLabel, thumbStyle, emptyHtml,
    liveCardHtml, videoCardHtml, newsItemHtml,
    getFilteredData, findNewsById,
    refreshYouTubeData, getYoutubeUpdateInfo,
  };
})();
