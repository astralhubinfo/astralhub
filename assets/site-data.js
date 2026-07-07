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
    return `<div class="media-card">
      <div class="media-thumb landscape" style="${thumbStyle(g)}">
        <span class="badge-viewers">🔥 ${item.viewers.toLocaleString()}</span>
        ${gameIconImgHtml(g, 'icon-md')}
      </div>
      <div class="card-tag-row"><span class="tag" style="background:${g.color}">${g.name}</span></div>
      <p class="card-title">${item.title}</p>
      <div class="card-meta"><span>${item.channel}</span></div>
    </div>`;
  }

  function videoCardHtml(item){
    const g = gameById(item.game);
    return `<div class="media-card">
      <div class="media-thumb landscape" style="${thumbStyle(g)}">
        <span class="badge-duration">${item.duration}</span>
        ${gameIconImgHtml(g, 'icon-md')}
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

    function passesChannelRules(channelName){
      if (blocked.has(channelName)) return false;
      if (japaneseOnlyEnabled && language.get(channelName) !== 'ja') return false;
      return true;
    }

    const activeSet = new Set(activeGameIds);
    return {
      news: news.filter(n => activeSet.has(n.game)),
      live: live.filter(v => activeSet.has(v.game) && passesChannelRules(v.channel)),
      videos: videos.filter(v => activeSet.has(v.game) && passesChannelRules(v.channel)),
    };
  }

  // 記事ページ(article.html)用：フィルターに関係なく、IDから該当ニュース1件を探す
  function findNewsById(id){
    const news = loadList(STORAGE_KEYS.news, SAMPLE_NEWS);
    return news.find(n => n.id === id) || null;
  }

  window.ASTRA_DATA = {
    loadJapaneseOnly, saveJapaneseOnly,
    gameById, timeAgoLabel, thumbStyle, emptyHtml,
    liveCardHtml, videoCardHtml, newsItemHtml,
    getFilteredData, findNewsById,
  };
})();
