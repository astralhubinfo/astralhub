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

  // 「日本語のみ表示」の初期値はON。一度でも設定を変更すると、その選択が保存され尊重される。
  function loadJapaneseOnly(){
    try {
      const v = localStorage.getItem(STORAGE_KEYS.japaneseOnly);
      if (v === null) return true;
      return v === '1';
    } catch (e) { return true; }
  }
  function saveJapaneseOnly(v){
    try { localStorage.setItem(STORAGE_KEYS.japaneseOnly, v ? '1' : '0'); } catch (e) { /* 無視 */ }
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
    return `<div class="media-card">
      <div class="media-thumb landscape" style="${thumbStyle(g)}">
        <span class="badge-viewers">🔥 ${item.viewers.toLocaleString()}</span>
        ${thumbInner}
      </div>
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
    return `<div class="media-card">
      <div class="media-thumb landscape" style="${thumbStyle(g)}">
        <span class="badge-duration">${item.duration}</span>
        ${thumbInner}
      </div>
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

  function getFilteredData(activeGameIds, japaneseOnlyEnabled){
    const news = loadList(STORAGE_KEYS.news, SAMPLE_NEWS);
    const live = loadList(STORAGE_KEYS.live, SAMPLE_LIVE);
    const videos = loadList(STORAGE_KEYS.videos, SAMPLE_VIDEOS);
    const ledger = loadChannelLedger();
    const blocked = new Set(ledger.filter(c => c.blocked === 'block').map(c => c.channel));
    const language = new Map(ledger.map(c => [c.channel, c.language]));

    function passesChannelRules(item){
      if (blocked.has(item.channel)) return false; // 管理画面での「ブロック」設定は、取得方法に関わらず常に有効
      // 自動取得（キーワード検索）したデータは、取得の時点ですでに日本語チェック済みなので、
      // 管理画面の台帳（手動登録チャンネル用）による日本語判定は行わない
      if (item.source === 'youtube-auto') return true;
      if (japaneseOnlyEnabled && language.get(item.channel) !== 'ja') return false;
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

  // ▼ここから追加：YouTube自動取得機能 ============================================
  // 役割：config.js に登録されたチャンネルから、YouTubeの「配信中LIVE」と「最近の動画」を
  //       取得し、既存のSTORAGE_KEYS.live / STORAGE_KEYS.videos にそのまま保存する。
  //       保存後は、今まで通り loadList() や liveCardHtml() 等がそのまま使える。

  const YT_LAST_FETCH_KEY = 'astra_youtube_last_fetch'; // 最後に取得した時刻を覚えておく
  const YT_CACHE_MINUTES_DEFAULT = 120; // config.js側の設定が無い場合の初期値（分）

  async function ytFetchJson(url){
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error('YouTube APIエラー: ' + res.status + ' ' + body);
    }
    return res.json();
  }

  // ISO8601形式の動画時間（例: "PT4M13S"）を "4:13" のような表示用の文字列に変換する
  function ytFormatDuration(iso){
    const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    const mm = h > 0 ? String(min).padStart(2, '0') : String(min);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // キーワードで「配信中のLIVE」を検索する（チャンネル登録が不要な自動取得方式）
  async function ytSearchLiveByKeyword(keyword, apiKey){
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&eventType=live&type=video&relevanceLanguage=ja&maxResults=10&key=${apiKey}`;
    const data = await ytFetchJson(url);
    return data.items || [];
  }

  // キーワードで「動画」を新しい順に検索する（チャンネル登録が不要な自動取得方式）
  async function ytSearchRecentVideosByKeyword(keyword, apiKey){
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&order=date&type=video&relevanceLanguage=ja&maxResults=10&key=${apiKey}`;
    const data = await ytFetchJson(url);
    return data.items || [];
  }

  // 動画IDの一覧から、再生回数・動画の長さ・タグ・同時視聴者数などの詳細情報を取得する
  async function ytFetchVideoDetails(videoIds, apiKey){
    if (videoIds.length === 0) return [];
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${videoIds.join(',')}&key=${apiKey}`;
    const data = await ytFetchJson(url);
    return data.items || [];
  }

  // タイトル・概要欄に、ひらがな・カタカナがある程度含まれているかで「日本語コンテンツか」を簡易判定する
  function ytIsJapaneseText(text){
    if (!text) return false;
    const kana = text.match(/[\u3040-\u30FF]/g); // ひらがな・カタカナの範囲
    return !!kana && kana.length >= 3;
  }

  // 投稿者が動画に付けた「タグ」に、対象ゲームのキーワードが含まれているかを確認する
  function ytMatchesGameTag(detail, keyword){
    const tags = (detail && detail.snippet && Array.isArray(detail.snippet.tags)) ? detail.snippet.tags : [];
    return tags.some(t => t.toLowerCase().includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(t.toLowerCase()));
  }

  // 「対象ゲームの動画らしいか」＋「日本語コンテンツか」の両方を満たすかチェックする
  // タグにゲーム名があればOK。タグが無い投稿者もいるため、タイトル・概要欄にキーワードが含まれる場合も許可する
  function ytPassesContentFilter(searchItem, detail, keyword){
    const title = (searchItem.snippet && searchItem.snippet.title) || '';
    const desc = (searchItem.snippet && searchItem.snippet.description) || '';
    const japaneseOk = ytIsJapaneseText(title + desc);
    const relevanceOk = ytMatchesGameTag(detail, keyword) || title.includes(keyword) || desc.includes(keyword);
    return japaneseOk && relevanceOk;
  }

  // 60秒以下の動画は「ショート動画」とみなし、ノイズとして除外する
  function ytIsShort(detail){
    const iso = detail && detail.contentDetails && detail.contentDetails.duration;
    if (!iso) return false;
    const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const totalSeconds = (parseInt(m[1]||'0',10) * 3600) + (parseInt(m[2]||'0',10) * 60) + parseInt(m[3]||'0',10);
    return totalSeconds > 0 && totalSeconds <= 60;
  }

  // 取得したYouTubeのデータを、AstralHubのカードがそのまま読める形に変換する
  // source: 'youtube-auto' は「自動取得したデータで、取得時に日本語チェック済み」の目印
  function ytBuildLiveItem(gameId, snippetItem, detail){
    return {
      id: snippetItem.id.videoId,
      game: gameId,
      source: 'youtube-auto',
      title: snippetItem.snippet.title,
      channel: snippetItem.snippet.channelTitle,
      thumbnail: (snippetItem.snippet.thumbnails && (snippetItem.snippet.thumbnails.medium || snippetItem.snippet.thumbnails.default) || {}).url || '',
      viewers: (detail && detail.liveStreamingDetails && detail.liveStreamingDetails.concurrentViewers)
        ? parseInt(detail.liveStreamingDetails.concurrentViewers, 10) : 0,
    };
  }

  function ytBuildVideoItem(gameId, snippetItem, detail){
    return {
      id: snippetItem.id.videoId,
      game: gameId,
      source: 'youtube-auto',
      title: snippetItem.snippet.title,
      channel: snippetItem.snippet.channelTitle,
      thumbnail: (snippetItem.snippet.thumbnails && (snippetItem.snippet.thumbnails.medium || snippetItem.snippet.thumbnails.default) || {}).url || '',
      views: (detail && detail.statistics && detail.statistics.viewCount)
        ? parseInt(detail.statistics.viewCount, 10) : 0,
      duration: (detail && detail.contentDetails && detail.contentDetails.duration)
        ? ytFormatDuration(detail.contentDetails.duration) : '',
      publishedAt: snippetItem.snippet.publishedAt,
    };
  }

  // config.js に登録された全キーワード分、YouTubeからデータを検索・取得してlocalStorageに保存する
  // 「ショート動画」は除外し、「日本語コンテンツらしいもの」だけを残す
  // index.html / list.html の読み込み時に1回呼び出す想定
  async function refreshYouTubeData(){
    const apiKey = window.ASTRA_CONFIG.YOUTUBE_API_KEY;
    const keywordList = window.ASTRA_CONFIG.YOUTUBE_SEARCH_KEYWORDS || [];
    const cacheMinutes = window.ASTRA_CONFIG.YT_CACHE_MINUTES || YT_CACHE_MINUTES_DEFAULT;

    if (!apiKey || apiKey.indexOf('ここに') === 0) {
      console.warn('[AstralHub] YouTube APIキーが未設定のため、自動取得はスキップされました。');
      return false;
    }

    // 前回の取得から一定時間が経っていなければ何もしない（APIの上限を使い切らないため）
    const lastFetch = parseInt(localStorage.getItem(YT_LAST_FETCH_KEY) || '0', 10);
    if (Date.now() - lastFetch < cacheMinutes * 60000) return false;

    const allLive = [];
    const allVideos = [];

    for (const entry of keywordList) {
      try {
        const [liveItems, videoItems] = await Promise.all([
          ytSearchLiveByKeyword(entry.keyword, apiKey),
          ytSearchRecentVideosByKeyword(entry.keyword, apiKey),
        ]);

        const videoIds = [...liveItems, ...videoItems].map(i => i.id.videoId);
        const details = await ytFetchVideoDetails(videoIds, apiKey);
        const detailById = new Map(details.map(d => [d.id, d]));

        liveItems.forEach(item => {
          const detail = detailById.get(item.id.videoId);
          if (!ytPassesContentFilter(item, detail, entry.keyword)) return;
          allLive.push(ytBuildLiveItem(entry.gameId, item, detail));
        });

        videoItems.forEach(item => {
          const detail = detailById.get(item.id.videoId);
          if (ytIsShort(detail)) return; // ショート動画は除外
          if (!ytPassesContentFilter(item, detail, entry.keyword)) return;
          allVideos.push(ytBuildVideoItem(entry.gameId, item, detail));
        });
      } catch (e) {
        console.error('[AstralHub] YouTubeデータの取得に失敗しました（キーワード: ' + entry.keyword + '）', e);
      }
    }

    try {
      localStorage.setItem(STORAGE_KEYS.live, JSON.stringify(allLive));
      localStorage.setItem(STORAGE_KEYS.videos, JSON.stringify(allVideos));
      localStorage.setItem(YT_LAST_FETCH_KEY, String(Date.now()));
      return true;
    } catch (e) {
      console.error('[AstralHub] 取得したデータの保存に失敗しました', e);
      return false;
    }
  }

  // 「最終更新はいつか」「何分ごとに更新されるか」をHTML側で表示するための情報を返す
  function getYoutubeUpdateInfo(){
    const cacheMinutes = (window.ASTRA_CONFIG && window.ASTRA_CONFIG.YT_CACHE_MINUTES) || YT_CACHE_MINUTES_DEFAULT;
    let lastFetchAt = null;
    try {
      const v = localStorage.getItem(YT_LAST_FETCH_KEY);
      lastFetchAt = v ? parseInt(v, 10) : null;
    } catch (e) { /* 無視 */ }
    return { lastFetchAt, cacheMinutes };
  }
  // ▲ここまで追加 ============================================

  window.ASTRA_DATA = {
    loadJapaneseOnly, saveJapaneseOnly,
    gameById, timeAgoLabel, thumbStyle, emptyHtml,
    liveCardHtml, videoCardHtml, newsItemHtml,
    getFilteredData, findNewsById,
    refreshYouTubeData, getYoutubeUpdateInfo,
  };
})();
