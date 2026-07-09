/**
 * AstralHub 共通設定ファイル
 * index.html と admin.html の両方から読み込まれます。
 * ゲームやカテゴリを追加・変更したい場合は、ここだけ直せば両方に反映されます。
 */
window.ASTRA_CONFIG = {
  // ▼ここから追加：YouTube API連携用の設定
  YOUTUBE_API_KEY: 'AIzaSyAN1XbEGMo432SB8Df_6r7UCRbhOgJhPLA',

  // ゲームごとに「どのYouTubeチャンネルから取得するか」を紐づける表
  // チャンネルを増やしたい場合は、この中に { id:'ゲームid', channelId:'UCから始まる文字列' } を追加するだけでOK
  YOUTUBE_CHANNELS: [
    { gameId: 'genshin', channelId: 'UCAVR6Q0YgYa8xwz8rdg9Mrg' }, // 原神-Genshin-公式（@Genshin_JP）
  ],
  // ▲ここまで追加

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
    japaneseOnly: 'astra_filter_japanese_only',
  }
};
