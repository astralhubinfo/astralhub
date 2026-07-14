export default {
  async fetch(request, env) {
    const authHeader = request.headers.get("Authorization");

    if (authHeader) {
      const [scheme, encoded] = authHeader.split(" ");

      if (scheme === "Basic" && encoded) {
        const decoded = atob(encoded);
        const separatorIndex = decoded.indexOf(":");
        const user = decoded.substring(0, separatorIndex);
        const pass = decoded.substring(separatorIndex + 1);

        if (user === env.BASIC_AUTH_USER && pass === env.BASIC_AUTH_PASS) {
          // パスワードが正しければ、いつも通りサイトを表示する
          return env.ASSETS.fetch(request);
        }
      }
    }

    // パスワードが未入力・間違っている場合はブロックする
    return new Response("このサイトはただいま準備中です。", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="AstralHub - Preview"',
      },
    });
  },
};
