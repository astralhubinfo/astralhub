/**
 * AstralHub 共通データ処理ファイル
 * index.html / list.html / article.html から読み込まれる。
 * localStorageからの読み込み・カード描画のHTML生成などの
 * 「データをどう扱うか」に関する処理をここにまとめている。
 * 表示に関わる状態（フィルターの選択状態など）は各ページ側で管理する。
 */
(function () {
  const { CATEGORY_LABEL, STORAGE_KEYS } = window.ASTRA_CONFIG;

  function loadChannelLedger(){
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.channels);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function gameById(id){ return window.ASTRA_CONFIG.GAMES.find(g => g.id === id); }

  // ゲームの「略称」の一覧。ここに登録したゲームは必ずこの表記で表示される。
  // 登録されていないゲームは、ゲーム名の先頭3文字を自動的に使う（config.jsに新しいゲームを追加した際、
  // ここに追記しなくても最低限の表示崩れは起きないようにするための保険）。
  const GAME_SHORT_NAME = {
    hsr: '崩スタ',
    zzz: 'ZZZ',
  };
  function shortNameFor(g){
    if (!g) return '';
    if (Object.prototype.hasOwnProperty.call(GAME_SHORT_NAME, g.id)) return GAME_SHORT_NAME[g.id];
    return g.name.length <= 3 ? g.name : g.name.slice(0, 3);
  }

  // ニュースを「固定表示」のものを先頭に、それぞれのグループ内では新しい順に並べ替える。
  // index.html(サイドバー・スマホ表示)・list.html(ニュース一覧)の両方から共通で使う。
  function sortNewsForDisplay(list){
    return [...list].sort((a, b) => {
      const pinnedA = a.pinned === 'pinned' ? 1 : 0;
      const pinnedB = b.pinned === 'pinned' ? 1 : 0;
      if (pinnedA !== pinnedB) return pinnedB - pinnedA; // 固定を先に
      return new Date(b.publishedAt) - new Date(a.publishedAt); // 新しい順
    });
  }

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

  function loadingHtml(){
    return `<div class="empty-state loading-state">読み込み中…</div>`;
  }

  // ゲームアイコン（文字表示版）。画像は使わず、略称の文字だけを色付きバッジで表示する。
  // サイズは sizeClass（icon-sm / icon-md）とCSS側の固定サイズ指定によって、どのゲームでも統一される。
  function gameIconTextHtml(g, sizeClass){
    return `<span class="game-icon-text ${sizeClass || ''}" style="background:${g.color}" title="${g.name}">${shortNameFor(g)}</span>`;
  }

  function liveCardHtml(item){
    const g = gameById(item.game);
    const thumbInner = item.thumbnail
      ? `<img class="media-thumb-img" src="${item.thumbnail}" alt="">`
      : gameIconTextHtml(g, 'icon-md');
    const thumbTag = item.url ? 'a' : 'div';
    const thumbLinkAttrs = item.url ? ` href="${item.url}" target="_blank" rel="noopener noreferrer"` : '';
    return `<div class="media-card">
      <${thumbTag} class="media-thumb landscape" style="${thumbStyle(g)}"${thumbLinkAttrs}>
        <span class="badge-viewers">🔥 ${item.viewers.toLocaleString()}</span>
        ${thumbInner}
      </${thumbTag}>
      <div class="card-tag-row"><span class="tag tag-game" style="background:${g.color}" title="${g.name}">${shortNameFor(g)}</span></div>
      <p class="card-title">${item.title}</p>
      <div class="card-meta"><span>${item.channel}</span></div>
    </div>`;
  }

  function videoCardHtml(item){
    const g = gameById(item.game);
    const thumbInner = item.thumbnail
      ? `<img class="media-thumb-img" src="${item.thumbnail}" alt="">`
      : gameIconTextHtml(g, 'icon-md');
    const thumbTag = item.url ? 'a' : 'div';
    const thumbLinkAttrs = item.url ? ` href="${item.url}" target="_blank" rel="noopener noreferrer"` : '';
    return `<div class="media-card">
      <${thumbTag} class="media-thumb landscape" style="${thumbStyle(g)}"${thumbLinkAttrs}>
        <span class="badge-duration">${item.duration}</span>
        ${thumbInner}
      </${thumbTag}>
      <div class="card-tag-row"><span class="tag tag-game" style="background:${g.color}" title="${g.name}">${shortNameFor(g)}</span></div>
      <p class="card-title">${item.title}</p>
      <div class="card-meta"><span>${item.channel}</span><span>${item.views.toLocaleString()}回視聴</span></div>
    </div>`;
  }

  function newsItemHtml(item){
    const g = gameById(item.game);
    const inner = `
      <div class="news-body">
        <div class="card-tag-row">
          ${item.pinned === 'pinned' ? '<span class="tag tag-pinned">📌 固定</span>' : ''}
          <span class="tag tag-game" style="background:${g.color}" title="${g.name}">${shortNameFor(g)}</span>
          <span class="tag tag-cat">${CATEGORY_LABEL[item.cat]}</span>
        </div>
        <p class="news-title">${item.title}</p>
        ${item.cat === 'gacha' ? gachaPeriodHtml(item) : ''}
        <span class="news-time">${timeAgoLabel(item.publishedAt)}</span>
      </div>
      <div class="news-thumb" style="${thumbStyle(g)}">${gameIconTextHtml(g, 'icon-sm')}</div>
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
    // ニュースも、LIVE・動画と同じくデータベース(D1)から取得済みのデータ(cachedNews)を使う。
    const news = cachedNews !== null ? cachedNews : [];
    // LIVE・動画は、データベース(D1)から取得済みのデータ(cachedLive/cachedVideos)を使う。
    // まだ一度も取得できていない場合(ページを開いた直後など)は、取得できるまで空として扱う。
    const live = cachedLive !== null ? cachedLive : [];
    const videos = cachedVideos !== null ? cachedVideos : [];
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
      // LIVE・動画・ニュースがデータベースから一度でも読み込めているか(false中は「読み込み中…」を表示するために使う)
      youtubeLoaded: cachedLive !== null,
      newsLoaded: cachedNews !== null,
    };
  }

  // 記事ページ(article.html)用：フィルターに関係なく、IDから該当ニュース1件を探す
  function findNewsById(id){
    const news = cachedNews !== null ? cachedNews : [];
    return news.find(n => n.id === id) || null;
  }

  // ▼ここから追加：YouTube自動取得機能（サーバー経由・データベース方式） ============================================
  // 役割：LIVE配信・新着動画・人気動画の情報は、Cloudflare Workers側(YouTubeからの自動通知＋定期実行)
  //       によって、すでにデータベース(D1)に貯められている。
  //       ここでは、そのデータベースの中身を「/api/live」「/api/videos」から読みに行くだけを行う。
  //       （以前のように、ブラウザから直接YouTube APIへ問い合わせる処理は行わない）

  // ▼公式チャンネル（特別枠）の一覧 ============================================
  // ここに登録したチャンネルは、配信タイトルにゲーム名が入っていなくても、
  // 常に指定したゲームの枠に強制的に表示されます（タイトル判定は一切行いません）。
  // 各ゲームの公式チャンネルなど、「タイトルを見なくても、確実にそのゲームの配信だとわかっている」
  // チャンネルをここに登録してください。
  //
  //   キー（左側） : YouTubeのチャンネルID
  //   値（右側）   : 常に表示させたいゲームのID（config.js の GAMES に定義されているid）
  //
  // 例）'UCxxxxxxxxxxxxxxxxxxxxxx': 'genshin', // 原神 公式チャンネル
  //
  const OFFICIAL_CHANNELS = {
    // ★各ゲームの公式チャンネル
    'UCAVR6Q0YgYa8xwz8rdg9Mrg': 'genshin', // 原神 公式チャンネル
    'UCrzCIt5o0X88G9bCdrdbv6g': 'hsr',     // 崩壊：スターレイル 公式チャンネル
    'UCt09C9DPSuOGpHoitbcyCIQ': 'zzz',     // ゼンレスゾーンゼロ 公式チャンネル
    'UCGc93NguHRwzv1Rw9MyIcxQ': 'ww',      // 鳴潮 公式チャンネル
    'UClKUii0-uZwx6QOFIEJ1foA': 'nte',     // NTE 公式チャンネル
  };
  // ▲ここまで ============================================

  const YT_LAST_FETCH_KEY = 'astra_youtube_last_fetch'; // 最後に取得した時刻を覚えておく

  // データベース(D1)から取得した最新のLIVE・動画・ニュースデータを、一時的に覚えておくための入れ物。
  // ページを開いた直後(まだ一度も取得していない)は null のままで、その間は空として扱う。
  let cachedLive = null;
  let cachedVideos = null;
  let cachedNews = null;

  // サーバー(Cloudflare Workers)のAPIから、JSON形式のデータを取得する共通処理
  async function apiFetchJson(path){
    const res = await fetch(path);
    if (!res.ok) {
      const body = await res.text();
      throw new Error('データベースからの取得に失敗しました: ' + res.status + ' ' + body);
    }
    return res.json();
  }

  // 秒数を "4:13" のような表示用の文字列に変換する
  function secondsToDurationLabel(totalSeconds){
    const sec = Number(totalSeconds) || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // データベースの「live_status」の行を、LIVEカードがそのまま読める形に変換する
  function mapLiveRow(row){
    return {
      id: row.live_video_id,
      game: row.game,
      source: 'youtube-auto',
      channelId: row.channel_id,
      isOfficial: Object.prototype.hasOwnProperty.call(OFFICIAL_CHANNELS, row.channel_id),
      url: row.live_video_id ? ('https://www.youtube.com/watch?v=' + row.live_video_id) : '',
      title: row.title || '',
      channel: row.channel_name || '',
      thumbnail: row.thumbnail_url || '',
      viewers: Number(row.viewer_count) || 0,
    };
  }

  // データベースの「videos」の行を、動画カードがそのまま読める形に変換する
  // isOfficial: OFFICIAL_CHANNELSに登録されているチャンネルかどうかの目印。
  // これがtrueの動画は「人気動画」「新着動画」には出さず、「公式チャンネル」枠にのみ表示する(表示側の絞り込みで使用)。
  function mapVideoRow(row){
    return {
      id: row.video_id,
      game: row.game,
      source: 'youtube-auto',
      channelId: row.channel_id,
      isOfficial: Object.prototype.hasOwnProperty.call(OFFICIAL_CHANNELS, row.channel_id),
      url: 'https://www.youtube.com/watch?v=' + row.video_id,
      title: row.title || '',
      channel: row.channel_name || '',
      thumbnail: row.thumbnail_url || '',
      views: Number(row.view_count) || 0,
      duration: secondsToDurationLabel(row.duration_seconds),
      durationSeconds: Number(row.duration_seconds) || 0,
      publishedAt: row.published_at,
    };
  }

  // ▼「人気動画」ランキングに限って、短すぎる動画(実質ショート)を除外するための基準 ============
  // ショート判定(サイト全体からの除外、75秒以下)とは別の仕組みです。
  // ここで除外されても、動画自体は消えず「新着動画」には引き続き表示されます。
  // 対象は一般投稿者の動画のみ(公式チャンネルの人気タブには適用しません)。
  const MIN_POPULAR_DURATION_SECONDS = 150; // 2分30秒

  // 「人気動画」ランキングの対象にしてよいかどうかを判定する
  function isEligibleForPopular(item){
    return (item.durationSeconds || 0) >= MIN_POPULAR_DURATION_SECONDS;
  }
  // ▲ここまで ============================================

  // データベース(SQLite)由来の日時は「2026-07-20 12:34:56」のようにTを使わない形式で保存されているため、
  // ブラウザによってはそのままDateに渡すと日付が正しく読み取れないことがある(NaN日前・Invalid Date)。
  // ここでISO8601形式(Tとタイムゾーン付き)に変換しておく。
  function normalizeDate(str){
    if (!str) return str;
    return String(str).includes('T') ? str : String(str).replace(' ', 'T') + 'Z';
  }

  // ガチャのピックアップ一覧(JSON文字列)を、配列に変換する。壊れている場合は空配列を返す。
  function parseGachaItems(json){
    try {
      const arr = JSON.parse(json || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  // データベースの「news」の行を、ニュースカードがそのまま読める形に変換する
  // 【重要】publishedAtは、サーバー側(src/index.js)のSQLで "published_at AS publishedAt" と
  // 名前を付け替えて返しているため、ここでも row.publishedAt で受け取る必要がある
  // (row.published_at ではデータが取得できず、日付が空になってしまう)。
  function mapNewsRow(row){
    return {
      id: row.id,
      game: row.game,
      cat: row.cat,
      pinned: row.pinned || '',
      title: row.title || '',
      summary: row.summary || '',
      url: row.url || '',
      publishedAt: normalizeDate(row.publishedAt),
      gachaStart: normalizeDate(row.gachaStart),
      gachaEnd: normalizeDate(row.gachaEnd),
      gachaItems: parseGachaItems(row.gachaItems),
    };
  }

  // ▼ここから追加：ガチャの「残り◯日」表示・ピックアップ表 ============================================

  // 日時を "2026/08/21 04:00" のような表示用の文字列に変換する
  function formatDateTimeLabel(dateStr){
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ガチャの残り時間を計算する。
  // 戻り値: { label:'残り3日'などの表示文字列, urgent: 赤字にすべきか, ended: 終了済みか } / gachaEndが無ければnull
  //   ・残り24時間を切ったら「残り◯時間」表示に切り替える
  //   ・残り3日以内、または残り24時間以内の場合は urgent:true (赤字表示用)
  function gachaCountdownInfo(item){
    if (!item || !item.gachaEnd) return null;
    const endMs = new Date(item.gachaEnd).getTime();
    if (isNaN(endMs)) return null;

    const diffMs = endMs - Date.now();
    if (diffMs <= 0) return { label: '終了', urgent: true, ended: true };

    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours <= 24) {
      const hours = Math.max(1, Math.ceil(diffHours));
      return { label: `残り${hours}時間`, urgent: true, ended: false };
    }
    const diffDays = Math.ceil(diffHours / 24);
    return { label: `残り${diffDays}日`, urgent: diffDays <= 3, ended: false };
  }

  // 開催期間・残り時間をまとめたHTMLを返す(ニュース一覧のカード・記事詳細ページの両方で使う)
  function gachaPeriodHtml(item){
    const info = gachaCountdownInfo(item);
    if (!info) return '';
    const period = (item.gachaStart && item.gachaEnd)
      ? `${formatDateTimeLabel(item.gachaStart)} 〜 ${formatDateTimeLabel(item.gachaEnd)}`
      : '';
    return `<div class="gacha-period-row${info.urgent ? ' gacha-urgent' : ''}">
      ${period ? `<span class="gacha-period-range">${period}</span>` : ''}
      <span class="gacha-period-remain">${info.label}</span>
    </div>`;
  }

  // ピックアップ一覧を、キャラ枠・武器枠に分けた表(テーブル)のHTMLに変換する(記事詳細ページで使う)
  function gachaItemsTableHtml(items){
    if (!Array.isArray(items) || items.length === 0) return '';
    const esc = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsHtml = (list) => list.map(it => `<tr${it.highlight ? ' class="gacha-highlight-row"' : ''}>
      <td>${esc(it.name)}</td><td>${esc(it.rarity)}</td><td>${esc(it.type)}</td>
    </tr>`).join('');

    const characters = items.filter(it => it.kind !== 'weapon');
    const weapons = items.filter(it => it.kind === 'weapon');

    const block = (title, list, typeLabel) => {
      if (list.length === 0) return '';
      return `<div class="gacha-items-block">
        <p class="gacha-items-block-title">${title}</p>
        <table class="gacha-items-table">
          <thead><tr><th>名前</th><th>レアリティ</th><th>${typeLabel}</th></tr></thead>
          <tbody>${rowsHtml(list)}</tbody>
        </table>
      </div>`;
    };

    return block('キャラクター', characters, '属性') + block('武器', weapons, '武器種');
  }
  // ▲ここまで追加 ============================================
  // 取得したデータはcachedLive/cachedVideosに保存され、次にgetFilteredDataが呼ばれたときに使われる。
  // index.html / list.html の読み込み時に1回呼び出す想定(以前のYouTube直接取得版と同じ使い方です)。
  //
  // 【重要】以前とちがい、YouTubeへの問い合わせはこの関数の中では行いません。
  // YouTubeへの問い合わせ・LIVE検知・ショート動画の除外などは、すべてサーバー側
  // (Cloudflare Workersの自動通知の受け取り・定期実行)ですでに終わらせてあります。
  // ここでは、サーバー側が貯めておいてくれたデータベースの中身を読みに行くだけです。
  async function refreshYouTubeData(){
    try {
      const [liveRows, videoRows] = await Promise.all([
        apiFetchJson('/api/live'),
        apiFetchJson('/api/videos?days=30'),
      ]);
      cachedLive = liveRows.map(mapLiveRow);
      cachedVideos = videoRows.map(mapVideoRow);
      localStorage.setItem(YT_LAST_FETCH_KEY, String(Date.now()));
      return true;
    } catch (e) {
      console.error('[AstralHub] データベースからの取得に失敗しました', e);
      return false;
    }
  }

  // 「最終更新はいつか」をHTML側で表示するための情報を返す
  function getYoutubeUpdateInfo(){
    let lastFetchAt = null;
    try {
      const v = localStorage.getItem(YT_LAST_FETCH_KEY);
      lastFetchAt = v ? parseInt(v, 10) : null;
    } catch (e) { /* 無視 */ }
    return { lastFetchAt };
  }
  // ▲ここまで追加 ============================================

  // データベース(D1)から、ニュースの最新情報を取得する。
  // index.html / list.html / article.html の読み込み時に1回呼び出す想定。
  async function refreshNewsData(){
    try {
      const rows = await apiFetchJson('/api/news');
      cachedNews = rows.map(mapNewsRow);
      return true;
    } catch (e) {
      console.error('[AstralHub] ニュースの取得に失敗しました', e);
      cachedNews = cachedNews || []; // 取得に失敗しても、いつまでも「読み込み中」のままにならないようにする
      return false;
    }
  }

  window.ASTRA_DATA = {
    gameById, timeAgoLabel, thumbStyle, emptyHtml, loadingHtml, shortNameFor, gameIconTextHtml,
    liveCardHtml, videoCardHtml, newsItemHtml, sortNewsForDisplay,
    getFilteredData, findNewsById, isEligibleForPopular,
    gachaCountdownInfo, gachaPeriodHtml, gachaItemsTableHtml, formatDateTimeLabel,
    refreshYouTubeData, getYoutubeUpdateInfo, refreshNewsData,
  };
})();
