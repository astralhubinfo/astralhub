/**
 * AstralHub 共通設定ファイル
 * index.html と admin.html の両方から読み込まれます。
 * ゲームやチャンネルを追加・変更したい場合は、ここだけ直せば両方に反映されます。
 */
window.ASTRA_CONFIG = {
  // ▼YouTube自動取得（チャンネル指定方式）の設定
  YOUTUBE_API_KEY: 'AIzaSyAN1XbEGMo432SB8Df_6r7UCRbhOgJhPLA',

  // 監視したいチャンネルの一覧です。
  // 「検索」ではなく「このチャンネルだけを見に行く」方式にしたので、API消費が大幅に減ります。
  //
  // ▼チャンネルIDの調べ方（初心者向け）
  // 1. 見たいYouTubeチャンネルのページを開く
  // 2. チャンネル名の下の「…」または概要欄から「チャンネルIDをコピー」を選ぶ
  //    （見つからない場合は「チャンネル名 + チャンネルID」でGoogle検索してもOKです）
  // 3. "UC" から始まる24文字の文字列をコピーして、下の channelId に貼り付ける
  //
  // ▼各項目の意味
  //   channelId : そのチャンネル固有のID（上記の方法で取得）
  //   gameId    : どのゲームの配信者か（GAMESのidと合わせる。例: 'genshin'）
  //   label     : 管理画面で見分けるための名前（表示には使いません、メモ用）
  //
  YOUTUBE_CHANNELS: [
    // ★動作確認用：24時間LIVE配信しているウェザーニュース公式チャンネル
    // 　（LIVE表示が正しく動くかのテスト用です。本番に不要になったらこの1行を削除するだけでOK）
    { channelId: 'UCNsidkYpIAQ4QaufptQBPHQ', gameId: 'test', label: 'ウェザーニュース（LIVEテスト用）' },

    // ↓ここから下に、実際に登録したい配信者・公式チャンネルを追加していってください
    // 例）{ channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', gameId: 'genshin', label: '原神公式' },
  ],

  // 動画の種類ごとの更新頻度（分単位）
  // LIVEは0（=毎回リアルタイムで確認）、動画はAPI節約のため少し間隔をあけます
  CACHE_MINUTES: {
    live: 0,     // LIVEは常に最新を確認（リアルタイム性を優先）
    videos: 5,   // 通常動画・新着は5分キャッシュ
  },

  // ショート動画（縦型の短い動画）を一覧から除外するための基準
  SHORTS_FILTER: {
    // この秒数以下の動画はショートとみなして除外します（3分 = 180秒）
    MAX_DURATION_SECONDS: 180,
    // URLにこの文字列が含まれる場合もショートとみなして除外します
    URL_KEYWORD: '/shorts/',
  },
  // ▲ここまで

  GAMES: [
    { id: 'genshin', name: '原神',            color: '#6EC6FF', icon: 'assets/games/genshin.svg' },
    { id: 'hsr',     name: '崩壊：スターレイル', color: '#243B7A', icon: 'assets/games/hsr.svg' },
    { id: 'zzz',     name: 'ゼンレスゾーンゼロ', color: '#FF8A2A', icon: 'assets/games/zzz.svg' },
    { id: 'ww',      name: '鳴潮',             color: '#E6B422', icon: 'assets/games/ww.svg' },
    { id: 'nte',     name: 'NTE',             color: '#8B5CF6', icon: 'assets/games/nte.svg' },
  ],
  CATEGORY_LABEL: {
    character:   '新キャラ',
    version:     'Ver情報',
    stream:      '生放送',
    code:        'コード',
    event:       'イベント',
    maintenance: 'メンテ',
  },
  SECTION_LABELS: {
    live: '配信（LIVE）',
    popular: '人気動画',
    latest: '新着動画',
  },
  STORAGE_KEYS: {
    news: 'astra_data_news',
    live: 'astra_data_live',
    videos: 'astra_data_videos',
    channels: 'astra_data_channels',
    sectionOrder: 'astra_section_order_list',
  }
};