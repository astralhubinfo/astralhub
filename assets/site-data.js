/**
 * AstraHub 共通データ処理ファイル
 * index.html と list.html の両方から読み込まれる。
 * サンプルデータ・localStorageからの読み込み・カード描画のHTML生成など、
 * 「データをどう扱うか」に関する処理をここにまとめている。
 * 表示に関わる状態（フィルターの選択状態など）は各ページ側で管理する。
 */
(function () {
  const { CATEGORY_LABEL, STORAGE_KEYS } = window.ASTRA_CONFIG;

  // ※以下はすべてサンプル（ダミー）データです。管理画面でデータを登録すると自動的にこちらは表示されなくなります。
  const SAMPLE_NEWS = [
    { game:'genshin', cat:'character',   title:'[サンプル] 新キャラクター「ドゥリン」公開', minutesAgo: 2 },
    { game:'hsr',     cat:'version',     title:'[サンプル] Ver.2.3「さよなら、ピノコニー」予告', minutesAgo: 15 },
    { game:'zzz',     cat:'stream',      title:'[サンプル] Ver.1.5 予告番組まとめ', minutesAgo: 60 },
    { game:'ww',      cat:'version',     title:'[サンプル] Ver.2.0「静寂の黎明」紹介', minutesAgo: 120 },
    { game:'nte',     cat:'event',       title:'[サンプル] クローズドβテスト募集開始', minutesAgo: 180 },
    { game:'genshin', cat:'maintenance', title:'[サンプル] 臨時メンテナンスのお知らせ', minutesAgo: 240 },
  ];
  const SAMPLE_LIVE = [
    { game:'genshin', title:'[サンプル] Ver.6.2 予告番組視聴枠', channel:'原神公式', viewers: 12345 },
    { game:'hsr',     title:'[サンプル] 開拓ラジオ 特別放送', channel:'崩壊：スターレイル公式', viewers: 8705 },
    { game:'zzz',     title:'[サンプル] 新エリー都へようこそ！', channel:'ZZZ公式', viewers: 6549 },
    { game:'ww',      title:'[サンプル] Ver.2.0 特別通信', channel:'鳴潮公式', viewers: 3210 },
    { game:'nte',     title:'[サンプル] 探索テスト 配信中！', channel:'NTE公式', viewers: 2111 },
  ];
  const SAMPLE_VIDEOS = [
    { game:'genshin', title:'[サンプル] Ver.6.2で絶対やるべきこと5選', channel:'原神公式', views: 287000, duration:'5:24', minutesAgo: 40 },
    { game:'hsr',     title:'[サンプル] 2.3速報！新キャラの性能解説', channel:'スターレイル攻略ch', views: 213000, duration:'3:40', minutesAgo: 90 },
    { game:'zzz',     title:'[サンプル] 新キャラ性能解説｜おすすめ編成', channel:'ZZZ攻略部', views: 189000, duration:'6:18', minutesAgo: 130 },
    { game:'ww',      title:'[サンプル] キャラ完全解説｜おすすめ武器・編成', channel:'鳴潮研究所', views: 124000, duration:'4:57', minutesAgo: 220 },
    { game:'nte',     title:'[サンプル] NTEの世界を10分で紹介', channel:'NTE公式', views: 98000, duration:'3:33', minutesAgo: 300 },
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

  function loadJapaneseOnly(){
    try { return localStorage.getItem(STORAGE_KEYS.japaneseOnly) === '1'; } catch (e) { return false; }
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

  function liveCardHtml(item){
    const g = gameById(item.game);
    return `<div class="media-card">
      <div class="media-thumb landscape" style="${thumbStyle(g)}">
        <span class="badge-viewers">🔥 ${item.viewers.toLocaleString()}</span>
        ${g.name}
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
        ${g.name}
      </div>
      <div class="card-tag-row"><span class="tag" style="background:${g.color}">${g.name}</span></div>
      <p class="card-title">${item.title}</p>
      <div class="card-meta"><span>${item.channel}</span><span>${item.views.toLocaleString()}回視聴</span></div>
    </div>`;
  }

  function newsItemHtml(item){
    const g = gameById(item.game);
    return `<div class="news-item">
      <div class="news-body">
        <div class="card-tag-row">
          <span class="tag" style="background:${g.color}">${g.name}</span>
          <span class="tag tag-cat">${CATEGORY_LABEL[item.cat]}</span>
        </div>
        <p class="news-title">${item.title}</p>
        <span class="news-time">${timeAgoLabel(item.publishedAt)}</span>
      </div>
      <div class="news-thumb" style="${thumbStyle(g)}">${g.name.slice(0,2)}</div>
    </div>`;
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

  window.ASTRA_DATA = {
    loadJapaneseOnly, saveJapaneseOnly,
    gameById, timeAgoLabel, thumbStyle, emptyHtml,
    liveCardHtml, videoCardHtml, newsItemHtml,
    getFilteredData,
  };
})();
