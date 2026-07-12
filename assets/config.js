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
  // ▼管理画面の「チャンネル発掘」タブで見つけたチャンネルは、そのままここに貼り付けられます。
  //
  YOUTUBE_CHANNELS: [
    // ↓ここに、実際に登録したい配信者・公式チャンネルを追加していってください
    // 例）{ channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', gameId: 'genshin', label: '原神公式' },

    // ★各ゲームの公式チャンネル
    // 　これらは site-data.js の OFFICIAL_CHANNELS にも登録されているため、
    // 　配信タイトルにゲーム名が入っていなくても、常に対応するゲーム枠に表示されます。
    { channelId: 'UCAVR6Q0YgYa8xwz8rdg9Mrg', gameId: 'genshin', label: '原神 公式チャンネル' },
    { channelId: 'UCrzCIt5o0X88G9bCdrdbv6g', gameId: 'hsr',     label: '崩壊：スターレイル 公式チャンネル' },
    { channelId: 'UCt09C9DPSuOGpHoitbcyCIQ', gameId: 'zzz',     label: 'ゼンレスゾーンゼロ 公式チャンネル' },
    { channelId: 'UCGc93NguHRwzv1Rw9MyIcxQ', gameId: 'ww',      label: '鳴潮 公式チャンネル' },
    { channelId: 'UClKUii0-uZwx6QOFIEJ1foA', gameId: 'nte',     label: 'NTE 公式チャンネル' },
  ],

  // 動画の種類ごとの更新頻度（分単位）
  // LIVEは0（=毎回リアルタイムで確認）、動画はAPI節約のため少し間隔をあけます
  CACHE_MINUTES: {
    // LIVE確認には消費の大きい「search API」を使うようになったため、
    // 0分（毎回チェック）のままだと将来チャンネル数が増えたときにAPIの上限に早く達してしまいます。
    // 3分に1回のチェックでも十分リアルタイムなLIVE表示ができるため、3分に設定しています。
    live: 3,
    videos: 5,   // 通常動画・新着は5分キャッシュ
  },

  // ショート動画（縦型の短い動画）を一覧から除外するための基準
  SHORTS_FILTER: {
    // この秒数以下の動画はショートとみなして除外します（1分 = 60秒）
    MAX_DURATION_SECONDS: 60,
    // URLにこの文字列が含まれる場合もショートとみなして除外します
    URL_KEYWORD: '/shorts/',
    // タイトルにこれらの文字列が含まれる場合、動画の長さに関係なくショートとみなして除外します
    // （投稿者が自分でショートだと示すために付けている目印のようなものです）
    TITLE_KEYWORDS: ['#shorts', '#short', '#ショート'],
  },

  // ▼ここから追加：タイトルキーワードによる自動仕分け・絞り込みの設定 ==========================
  // 1つのチャンネルが複数のゲームを配信する場合（例：原神チャンネルが崩壊：スターレイルの
  // 配信をした）に、配信タイトルを見て「本当はどのゲームの配信か」を自動判定するために
  // 使うキーワード一覧です。GAMESのidをキーにして、その中に含まれていたら該当ゲームとみなす
  // 単語を並べてください（大文字・小文字は区別しません）。
  // ※誤判定を防ぐため、判定に使うのは「配信タイトルのみ」です（概要欄・タグは使いません）。
  //
  // ▼使われ方（site-data.js 内、一般配信者向けの判定でのみ使用されます）
  //   ①タイトルが、登録チャンネルのgameIdとは別のゲームのキーワードに一致した場合
  //     → 保存するgameIdを、一致したゲームのIDに自動的に書き換えます（仕分け）
  //   ②どのゲームのキーワードにも一切一致しなかった場合
  //     → その配信はLocalStorageに保存せず除外します（無関係な配信の除外）
  //   ※なお、site-data.js の OFFICIAL_CHANNELS に登録されている公式チャンネルは、
  //     このキーワード判定を行わず、常に指定したゲーム枠に固定表示されます。
  //
  // ゲームを追加した場合は、GAMESだけでなくここにもキーワードを追加してください。
  GAME_KEYWORDS: {
    genshin: ['原神', 'Genshin', 'げんしん'],
    hsr:     ['スターレイル', '崩壊：スターレイル', '崩壊:スターレイル', 'HSR', 'Honkai: Star Rail'],
    zzz:     ['ゼンレスゾーンゼロ', 'ゼンゼロ', 'ZZZ', 'Zenless'],
    ww:      ['鳴潮', 'めいちょう', 'Wuthering Waves'],
    nte:     ['NTE'],
  },

  // ▲ここまで追加 ============================================

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
    official: '公式チャンネル',
    latest: '新着動画',
  },
  STORAGE_KEYS: {
    news: 'astra_data_news',
    live: 'astra_data_live',
    videos: 'astra_data_videos',
    channels: 'astra_data_channels',
    // 管理画面の「チャンネル登録（手動）」タブで登録したチャンネル（channelId, gameId, label）の保存先。
    // config.js の YOUTUBE_CHANNELS と合わせて、自動取得の対象チャンネルとして扱われます。
    manualChannels: 'astra_data_manual_channels',
    sectionOrder: 'astra_section_order_list',
  }
};
