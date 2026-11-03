const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:cors});
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {headers:cors});
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ok:true, service:"BARAR SALAT TIME backend"});
    if (url.pathname === "/api/login" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({ok:false,error:"Invalid JSON"},400); }
      const email = String(body.email || "").trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ok:false,error:"Valid email required"},400);
      const now = new Date().toISOString();
      const userId = crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO users (email, user_id, created_at, last_login_at, login_count)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(email) DO UPDATE SET last_login_at=excluded.last_login_at, login_count=users.login_count+1`)
          .bind(email,userId,now,now).run();
        const row = await env.DB.prepare("SELECT user_id FROM users WHERE email=?").bind(email).first();
        await env.DB.prepare("INSERT INTO login_events (email, user_id, logged_in_at, user_agent) VALUES (?, ?, ?, ?)")
          .bind(email,row.user_id,now,(request.headers.get("User-Agent")||"").slice(0,250)).run();
        return json({ok:true,userId:row.user_id,email,loggedInAt:now,verified:false});
      } catch (e) { return json({ok:false,error:"Database error"},500); }
    }
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      if (!env.ADMIN_TOKEN || request.headers.get("X-Admin-Token") !== env.ADMIN_TOKEN) return json({ok:false,error:"Unauthorized"},401);
      const rows = await env.DB.prepare("SELECT email,user_id,created_at,last_login_at,login_count FROM users ORDER BY last_login_at DESC LIMIT 500").all();
      return json({ok:true,users:rows.results||[]});
    }
    return json({ok:false,error:"Not found"},404);
  }
};
