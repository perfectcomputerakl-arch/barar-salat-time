const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const clean = v => String(v ?? "").trim();
const normalize = v => clean(v).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const validEmail = v => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validCoords = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

// Creates any missing tables (same definitions as schema.sql + schema_additive.sql), so login never fails
// just because a migration was not run. Existing tables and data are never touched.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS login_events (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, user_id TEXT NOT NULL, logged_in_at TEXT NOT NULL, user_agent TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_login_events_email ON login_events(email)`,
  `CREATE INDEX IF NOT EXISTS idx_login_events_time ON login_events(logged_in_at)`,
  `CREATE TABLE IF NOT EXISTS mobile_users (mobile TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, login_count INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS mobile_login_events (id INTEGER PRIMARY KEY AUTOINCREMENT, mobile TEXT NOT NULL, user_id TEXT NOT NULL, logged_in_at TEXT NOT NULL, user_agent TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_events_mobile ON mobile_login_events(mobile)`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_events_time ON mobile_login_events(logged_in_at)`,
  `CREATE TABLE IF NOT EXISTS masjid_submissions (request_id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, owner_email TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, normalized_city TEXT NOT NULL, pincode TEXT, phone TEXT, description TEXT, lat REAL NOT NULL, lon REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', duplicate_candidates TEXT NOT NULL DEFAULT '[]', submitted_at TEXT NOT NULL, reviewed_at TEXT, review_note TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_masjid_submissions_status ON masjid_submissions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_masjid_submissions_name_city ON masjid_submissions(normalized_name, normalized_city)`,
  `CREATE TABLE IF NOT EXISTS masjids (masjid_id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, owner_email TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, normalized_city TEXT NOT NULL, pincode TEXT, phone TEXT, description TEXT, lat REAL NOT NULL, lon REAL NOT NULL, source_request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_masjids_name_city ON masjids(normalized_name, normalized_city)`,
  `CREATE INDEX IF NOT EXISTS idx_masjids_owner_email ON masjids(owner_email)`,
  `CREATE INDEX IF NOT EXISTS idx_masjids_geo ON masjids(lat, lon)`,
  `CREATE TABLE IF NOT EXISTS submission_extra (request_id TEXT PRIMARY KEY, extra TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS masjid_details (masjid_id TEXT PRIMARY KEY, address2 TEXT, email TEXT, website TEXT, maktab INTEGER NOT NULL DEFAULT 0, women_area INTEGER NOT NULL DEFAULT 0, fiqh TEXT, capacity INTEGER, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jamaat_times (masjid_id TEXT PRIMARY KEY, fajr TEXT, zohar TEXT, asr TEXT, magrib TEXT, isha TEXT, juma TEXT, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS masjid_reports (report_id TEXT PRIMARY KEY, masjid_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, reporter TEXT, status TEXT NOT NULL DEFAULT 'open', submitted_at TEXT NOT NULL, resolved_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_status ON masjid_reports(status)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL)`
];
let schemaReady = null;
function ensureSchema(db) {
  if (!db) return Promise.reject(new Error("D1 binding DB is missing in wrangler.toml"));
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map(q => db.prepare(q))).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}
function distanceMeters(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
async function duplicateCandidates(db, item, excludeId) {
  const rows = await db.prepare(`SELECT masjid_id AS id, name, city, lat, lon, 'approved' AS record_type FROM masjids
    UNION ALL SELECT request_id AS id, name, city, lat, lon, 'pending' AS record_type FROM masjid_submissions WHERE status='pending'`).all();
  return (rows.results || []).map(x => ({ ...x, distance_m: Math.round(distanceMeters(item.lat, item.lon, x.lat, x.lon)) }))
    .filter(x => x.id !== excludeId && (x.distance_m <= 100 || (normalize(x.name) === item.normalized_name && normalize(x.city) === item.normalized_city)))
    .slice(0, 10);
}
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const TIME_KEYS = ["fajr", "zohar", "asr", "magrib", "isha", "juma"];
const flag = v => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
// Reads the optional mosque fields from a request body. Only fields present in the body are returned,
// so the same function serves both "submit" (fills defaults later) and "edit" (partial update).
function parseExtras(body) {
  const details = {}, times = {};
  if ("address2" in body) details.address2 = clean(body.address2).slice(0, 300);
  if ("email" in body) {
    const e = clean(body.email).toLowerCase();
    if (e && !validEmail(e)) return { error: "Invalid mosque email" };
    details.email = e;
  }
  if ("website" in body) {
    let w = clean(body.website);
    if (w) {
      if (!/^https?:\/\//i.test(w)) w = "https://" + w;
      try { new URL(w); } catch { return { error: "Invalid website" }; }
      if (w.length > 200) return { error: "Website too long" };
    }
    details.website = w;
  }
  if ("maktab" in body) details.maktab = flag(body.maktab) ? 1 : 0;
  if ("womenArea" in body) details.women_area = flag(body.womenArea) ? 1 : 0;
  if ("fiqh" in body) details.fiqh = clean(body.fiqh).slice(0, 40);
  if ("capacity" in body) {
    const raw = clean(body.capacity);
    if (raw === "") details.capacity = null;
    else {
      const c = Number(raw);
      if (!Number.isInteger(c) || c < 0 || c > 1000000) return { error: "Capacity must be a whole number" };
      details.capacity = c;
    }
  }
  const t = body.times && typeof body.times === "object" ? body.times : {};
  for (const k of TIME_KEYS) {
    if (!(k in t)) continue;
    const v = clean(t[k]);
    if (v && !TIME_RE.test(v)) return { error: `Invalid time for ${k}. Use HH:MM` };
    times[k] = v || null;
  }
  return { details, times };
}
const MASJID_SELECT = `SELECT m.masjid_id,m.name,m.address,m.city,m.pincode,m.phone,m.description,m.lat,m.lon,
  d.address2,d.email,d.website,d.maktab,d.women_area,d.fiqh,d.capacity,
  t.fajr,t.zohar,t.asr,t.magrib,t.isha,t.juma
  FROM masjids m LEFT JOIN masjid_details d ON d.masjid_id=m.masjid_id LEFT JOIN jamaat_times t ON t.masjid_id=m.masjid_id`;
const shapeMasjid = r => ({
  masjid_id: r.masjid_id, name: r.name, address: r.address, address2: r.address2 || "", city: r.city, pincode: r.pincode, phone: r.phone, description: r.description,
  lat: r.lat, lon: r.lon, email: r.email || "", website: r.website || "", maktab: !!r.maktab, womenArea: !!r.women_area, fiqh: r.fiqh || "", capacity: r.capacity ?? null,
  times: { fajr: r.fajr ?? null, zohar: r.zohar ?? null, asr: r.asr ?? null, magrib: r.magrib ?? null, isha: r.isha ?? null, juma: r.juma ?? null }
});
// Simple per-IP, per-endpoint limit: `limit` requests per minute. Fails open if the DB errors.
async function rateLimited(request, env, bucket, limit) {
  const key = `${bucket}:${request.headers.get("CF-Connecting-IP") || "unknown"}`, win = Math.floor(Date.now() / 60000);
  try {
    const row = await env.DB.prepare(`INSERT INTO rate_limits (k,win,n) VALUES (?,?,1) ON CONFLICT(k) DO UPDATE SET n=CASE WHEN rate_limits.win=excluded.win THEN rate_limits.n+1 ELSE 1 END, win=excluded.win RETURNING n`).bind(key, win).first();
    return !!row && row.n > limit;
  } catch { return false; }
}
async function isAdmin(request, env) {
  return !!env.ADMIN_TOKEN && request.headers.get("X-Admin-Token") === env.ADMIN_TOKEN;
}
const ADMIN_HTML = "<!doctype html>\n<html lang=\"en\"><head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex\">\n<title>BARAR SALAT TIME Admin</title>\n<style>\n:root{--bg:#2a0b10;--panel:#3a1017;--line:#6b4a2a;--gold:#d4af5a;--text:#f3e9d2;--muted:#b9a98a;--ok:#4f9a5f;--bad:#b4473f;color-scheme:dark}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;padding:12px 12px 48px;max-width:720px;margin-inline:auto}\nh1{font-size:20px;color:var(--gold);margin:8px 0 12px}\nh2{font-size:17px;margin:0 0 4px}\ninput,textarea,button{font:inherit;border-radius:10px}\ninput,textarea{width:100%;padding:10px 12px;background:#240a0e;color:var(--text);border:1px solid var(--line)}\nbutton{padding:10px 16px;border:1px solid var(--gold);background:transparent;color:var(--gold);cursor:pointer}\nbutton.solid{background:var(--gold);color:#2a0b10;font-weight:600}\nbutton.ok{border-color:var(--ok);color:#fff;background:var(--ok)}\nbutton.bad{border-color:var(--bad);color:#fff;background:var(--bad)}\nbutton:disabled{opacity:.5}\nbutton:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--gold);outline-offset:2px}\n.row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}\n.row>*{flex:1 1 auto}\n.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}\n.muted{color:var(--muted);font-size:14px}\n.dup{border-left:3px solid var(--bad);padding:6px 10px;margin:8px 0;background:#2a0b10;font-size:14px}\n.tabs{display:flex;gap:8px;margin:12px 0}\n.tabs button{flex:1}\n.tabs button.on{background:var(--gold);color:#2a0b10;font-weight:600}\n.msg{padding:10px 12px;border-radius:10px;margin:10px 0;background:#240a0e;border:1px solid var(--line)}\n.msg.err{border-color:var(--bad)}\na{color:var(--gold)}\ntable{width:100%;border-collapse:collapse;font-size:14px}\ntd,th{padding:6px 4px;border-bottom:1px solid var(--line);text-align:left;word-break:break-all}\n</style></head><body>\n<h1>BARAR SALAT TIME Admin</h1>\n<div id=\"login\" class=\"card\">\n  <label for=\"tok\" class=\"muted\">Admin token</label>\n  <input id=\"tok\" type=\"password\" autocomplete=\"off\" placeholder=\"Paste ADMIN_TOKEN\">\n  <div class=\"row\"><button class=\"solid\" id=\"go\">Sign in</button></div>\n</div>\n<div id=\"app\" hidden>\n  <div class=\"tabs\">\n    <button id=\"t-req\" class=\"on\">Requests</button>\n    <button id=\"t-usr\">Users</button>\n    <button id=\"t-rep\">Reports</button>\n    <button id=\"out\">Sign out</button>\n  </div>\n  <div id=\"msg\" class=\"msg\" hidden></div>\n  <div id=\"view\"></div>\n</div>\n<script>\n(function(){\nvar $=function(i){return document.getElementById(i)};\nvar tok=sessionStorage.getItem(\"adm\")||\"\";\nfunction el(tag,txt,cls){var e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e}\nfunction say(t,err){var m=$(\"msg\");m.textContent=t;m.className=\"msg\"+(err?\" err\":\"\");m.hidden=!t}\nfunction api(path,opt){\n  opt=opt||{};opt.headers=Object.assign({\"X-Admin-Token\":tok,\"Content-Type\":\"application/json\"},opt.headers||{});\n  return fetch(path,opt).then(function(r){return r.json().catch(function(){return {ok:false,error:\"Bad response\"}}).then(function(d){d._status=r.status;return d})});\n}\nfunction show(on){$(\"login\").hidden=on;$(\"app\").hidden=!on}\nfunction loadReq(){\n  say(\"Loading\u2026\");\n  api(\"/api/admin/masjid-requests\").then(function(d){\n    var v=$(\"view\");v.textContent=\"\";\n    if(d._status===401){say(\"Wrong token.\",true);sessionStorage.removeItem(\"adm\");show(false);return}\n    if(!d.ok){say(d.error||\"Could not load requests.\",true);return}\n    say(d.requests.length?\"\":\"No pending requests.\");\n    d.requests.forEach(function(r){v.appendChild(card(r))});\n  }).catch(function(){say(\"Network error. Check internet and try again.\",true)});\n}\nfunction dupBox(list){\n  var f=document.createDocumentFragment();\n  list.forEach(function(x){\n    f.appendChild(el(\"div\",x.name+\" (\"+x.city+\"), \"+x.distance_m+\" m away, \"+x.record_type,\"dup\"));\n  });return f;\n}\nfunction card(r){\n  var c=el(\"div\",null,\"card\");\n  c.appendChild(el(\"h2\",r.name));\n  c.appendChild(el(\"div\",r.address+\", \"+r.city+(r.pincode?\" \"+r.pincode:\"\"),\"muted\"));\n  c.appendChild(el(\"div\",\"Owner: \"+r.owner_email+(r.phone?\"  |  Phone: \"+r.phone:\"\"),\"muted\"));\n  if(r.description)c.appendChild(el(\"div\",r.description));\n  var a=el(\"a\",\"Open location on map\");a.href=\"https://www.google.com/maps?q=\"+encodeURIComponent(r.lat+\",\"+r.lon);a.target=\"_blank\";a.rel=\"noopener\";\n  var p=el(\"div\");p.appendChild(a);c.appendChild(p);\n  c.appendChild(el(\"div\",\"Submitted: \"+new Date(r.submitted_at).toLocaleString(),\"muted\"));\n  if(r.duplicate_candidates&&r.duplicate_candidates.length){\n    c.appendChild(el(\"div\",\"Possible duplicates found when submitted:\",\"muted\"));\n    c.appendChild(dupBox(r.duplicate_candidates));\n  }\n  var note=el(\"input\");note.placeholder=\"Note (optional)\";note.maxLength=300;c.appendChild(note);\n  var row=el(\"div\",null,\"row\");\n  var ap=el(\"button\",\"Approve\",\"ok\"),rj=el(\"button\",\"Reject\",\"bad\");\n  row.appendChild(ap);row.appendChild(rj);c.appendChild(row);\n  var dupZone=el(\"div\");c.appendChild(dupZone);\n  function decide(decision,force){\n    ap.disabled=rj.disabled=true;\n    api(\"/api/admin/masjid-decision\",{method:\"POST\",body:JSON.stringify({requestId:r.request_id,decision:decision,note:note.value,force:!!force})}).then(function(d){\n      if(d._status===409){\n        dupZone.textContent=\"\";\n        dupZone.appendChild(el(\"div\",d.error,\"muted\"));\n        dupZone.appendChild(dupBox(d.duplicateCandidates||[]));\n        var fb=el(\"button\",\"Approve anyway (separate masjid)\",\"ok\");\n        fb.onclick=function(){decide(\"approve\",true)};\n        dupZone.appendChild(fb);ap.disabled=rj.disabled=false;return;\n      }\n      if(d.ok){c.remove();say(d.status===\"approved\"?\"Approved. Masjid ID: \"+d.masjidId:\"Rejected.\")}\n      else{say(d.error||\"Failed.\",true);ap.disabled=rj.disabled=false}\n    }).catch(function(){say(\"Network error.\",true);ap.disabled=rj.disabled=false});\n  }\n  ap.onclick=function(){decide(\"approve\",false)};\n  rj.onclick=function(){if(confirm(\"Reject this request?\"))decide(\"reject\",false)};\n  return c;\n}\nfunction table(rows,cols){\n  var t=el(\"table\"),h=el(\"tr\");\n  cols.forEach(function(c){h.appendChild(el(\"th\",c[0]))});t.appendChild(h);\n  rows.forEach(function(r){var tr=el(\"tr\");cols.forEach(function(c){tr.appendChild(el(\"td\",c[1](r)))});t.appendChild(tr)});\n  return t;\n}\nfunction loadUsers(){\n  say(\"Loading\u2026\");\n  Promise.all([api(\"/api/admin/users\"),api(\"/api/admin/mobile-users\")]).then(function(a){\n    var v=$(\"view\");v.textContent=\"\";say(\"\");\n    if(!a[0].ok||!a[1].ok){say(\"Could not load users.\",true);return}\n    var c1=el(\"div\",null,\"card\");c1.appendChild(el(\"h2\",\"Email users (\"+a[0].users.length+\")\"));\n    c1.appendChild(table(a[0].users,[[\"Email\",function(u){return u.email}],[\"Logins\",function(u){return u.login_count}],[\"Last\",function(u){return u.last_login_at.slice(0,10)}]]));\n    var c2=el(\"div\",null,\"card\");c2.appendChild(el(\"h2\",\"Mobile users (\"+a[1].users.length+\")\"));\n    c2.appendChild(table(a[1].users,[[\"Mobile\",function(u){return u.mobile}],[\"Logins\",function(u){return u.login_count}],[\"Last\",function(u){return u.last_login_at.slice(0,10)}]]));\n    v.appendChild(c1);v.appendChild(c2);\n  }).catch(function(){say(\"Network error.\",true)});\n}\nfunction loadRep(){\n  say(\"Loading\");\n  api(\"/api/admin/masjid-reports\").then(function(d){\n    var v=$(\"view\");v.textContent=\"\";\n    if(d._status===401){say(\"Wrong token.\",true);sessionStorage.removeItem(\"adm\");show(false);return}\n    if(!d.ok){say(d.error||\"Could not load reports.\",true);return}\n    say(d.reports.length?\"\":\"No open reports.\");\n    d.reports.forEach(function(r){\n      var c=el(\"div\",null,\"card\");\n      c.appendChild(el(\"h2\",(r.masjid_name||r.masjid_id)+\" - \"+r.reason));\n      if(r.details)c.appendChild(el(\"div\",r.details));\n      c.appendChild(el(\"div\",\"Reporter: \"+(r.reporter||\"anonymous\")+\"  |  \"+new Date(r.submitted_at).toLocaleString(),\"muted\"));\n      var b=el(\"button\",\"Mark resolved\",\"ok\");\n      b.onclick=function(){b.disabled=true;api(\"/api/admin/report-resolve\",{method:\"POST\",body:JSON.stringify({reportId:r.report_id})}).then(function(x){if(x.ok)c.remove();else{say(x.error||\"Failed.\",true);b.disabled=false}})};\n      c.appendChild(b);v.appendChild(c);\n    });\n  }).catch(function(){say(\"Network error.\",true)});\n}\nfunction tab(which){\n  $(\"t-req\").className=which===\"r\"?\"on\":\"\";$(\"t-usr\").className=which===\"u\"?\"on\":\"\";$(\"t-rep\").className=which===\"p\"?\"on\":\"\";\n  which===\"r\"?loadReq():which===\"p\"?loadRep():loadUsers();\n}\n$(\"go\").onclick=function(){tok=$(\"tok\").value.trim();if(!tok)return;sessionStorage.setItem(\"adm\",tok);$(\"tok\").value=\"\";show(true);tab(\"r\")};\n$(\"tok\").addEventListener(\"keydown\",function(e){if(e.key===\"Enter\")$(\"go\").click()});\n$(\"t-req\").onclick=function(){tab(\"r\")};\n$(\"t-usr\").onclick=function(){tab(\"u\")};\n$(\"t-rep\").onclick=function(){tab(\"p\")};\n$(\"out\").onclick=function(){sessionStorage.removeItem(\"adm\");tok=\"\";show(false);$(\"view\").textContent=\"\";say(\"\")};\nif(tok){show(true);tab(\"r\")}\n})();\n</script></body></html>\n";
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if ((url.pathname === "/" || url.pathname === "/api/health") && request.method === "GET")
      return json({ ok: true, service: "BARAR SALAT TIME Backend", status: "Running", version: "1.5.0" });

    if ((url.pathname === "/admin" || url.pathname === "/admin/") && request.method === "GET")
      return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

    if (url.pathname.startsWith("/api/")) {
      try { await ensureSchema(env.DB); }
      catch (e) { console.error("schema setup failed", e); return json({ ok: false, error: "Database not ready", detail: String((e && e.message) || e).slice(0, 200) }, 500); }
    }

    if (request.method === "POST") {
      const lim = { "/api/login": 20, "/api/mobile-login": 20, "/api/masjids/submit": 5, "/api/masjids/edit": 10, "/api/masjids/report": 5 }[url.pathname];
      if (lim && await rateLimited(request, env, url.pathname, lim)) return json({ ok: false, error: "Too many requests. Try again in a minute." }, 429);
    }

    // Existing email login: preserves existing email user IDs and history.
    if (url.pathname === "/api/login" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid JSON" }, 400);
      const email = clean(body.email).toLowerCase();
      if (!validEmail(email)) return json({ ok: false, error: "Valid email required" }, 400);
      const now = new Date().toISOString(), newId = crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO users (email,user_id,created_at,last_login_at,login_count) VALUES (?,?,?,?,1)
          ON CONFLICT(email) DO UPDATE SET last_login_at=excluded.last_login_at, login_count=users.login_count+1`)
          .bind(email, newId, now, now).run();
        const row = await env.DB.prepare("SELECT user_id FROM users WHERE email=?").bind(email).first();
        await env.DB.prepare("INSERT INTO login_events (email,user_id,logged_in_at,user_agent) VALUES (?,?,?,?)")
          .bind(email, row.user_id, now, (request.headers.get("User-Agent") || "").slice(0, 250)).run();
        return json({ ok: true, userId: row.user_id, email, loggedInAt: now, verified: false });
      } catch (e) { console.error("login failed", e); return json({ ok: false, error: "Database error", detail: String((e && e.message) || e).slice(0, 200) }, 500); }
    }

    // Mobile login without OTP, as currently requested. Number ownership is NOT verified.
    if (url.pathname === "/api/mobile-login" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid JSON" }, 400);
      let mobile = clean(body.mobile).replace(/[\s()-]/g, "");
      if (/^[6-9]\d{9}$/.test(mobile)) mobile = "+91" + mobile;
      if (!/^\+91[6-9]\d{9}$/.test(mobile)) return json({ ok: false, error: "Valid Indian mobile number required" }, 400);
      const now = new Date().toISOString(), newId = crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO mobile_users (mobile,user_id,created_at,last_login_at,login_count) VALUES (?,?,?,?,1)
          ON CONFLICT(mobile) DO UPDATE SET last_login_at=excluded.last_login_at, login_count=mobile_users.login_count+1`)
          .bind(mobile, newId, now, now).run();
        const row = await env.DB.prepare("SELECT user_id FROM mobile_users WHERE mobile=?").bind(mobile).first();
        await env.DB.prepare("INSERT INTO mobile_login_events (mobile,user_id,logged_in_at,user_agent) VALUES (?,?,?,?)")
          .bind(mobile, row.user_id, now, (request.headers.get("User-Agent") || "").slice(0, 250)).run();
        return json({ ok: true, userId: row.user_id, mobile, loggedInAt: now, verified: false, otpRequired: false });
      } catch (e) { console.error("login failed", e); return json({ ok: false, error: "Database error", detail: String((e && e.message) || e).slice(0, 200) }, 500); }
    }

    // New mosque request. All requests remain pending until an admin approves them.
    if (url.pathname === "/api/masjids/submit" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid JSON" }, 400);
      const name = clean(body.name), ownerEmail = clean(body.ownerEmail).toLowerCase(), address = clean(body.address), city = clean(body.city);
      const lat = Number(body.lat), lon = Number(body.lon), normalizedName = normalize(name), normalizedCity = normalize(city);
      if (!name || name.length > 160 || !validEmail(ownerEmail) || !address || address.length > 300 || !city || city.length > 100 || !validCoords(lat, lon))
        return json({ ok: false, error: "Name, valid permanent admin email, address, city and GPS coordinates are required" }, 400);
      const ex = parseExtras(body); if (ex.error) return json({ ok: false, error: ex.error }, 400);
      const item = { name, ownerEmail, address, city, lat, lon, normalized_name: normalizedName, normalized_city: normalizedCity };
      try {
        const existingReq = await env.DB.prepare(`SELECT request_id,status FROM masjid_submissions WHERE owner_email=? AND normalized_name=? AND normalized_city=? AND status IN ('pending','approved') LIMIT 1`)
          .bind(ownerEmail, normalizedName, normalizedCity).first();
        if (existingReq) return json({ ok: true, alreadySubmitted: true, requestId: existingReq.request_id, status: existingReq.status, message: "This mosque request already exists for this email." });
        const candidates = await duplicateCandidates(env.DB, item);
        const requestId = crypto.randomUUID(), now = new Date().toISOString();
        await env.DB.prepare(`INSERT INTO masjid_submissions (request_id,name,normalized_name,owner_email,address,city,normalized_city,pincode,phone,description,lat,lon,status,duplicate_candidates,submitted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`)
          .bind(requestId, name, normalizedName, ownerEmail, address, city, normalizedCity, clean(body.pincode), clean(body.phone), clean(body.description), lat, lon, JSON.stringify(candidates), now).run();
        await env.DB.prepare("INSERT INTO submission_extra (request_id,extra) VALUES (?,?)").bind(requestId, JSON.stringify({ details: ex.details, times: ex.times })).run();
        return json({ ok: true, requestId, status: "pending", duplicateCandidates: candidates, message: "Submitted for admin review. Not public until approved." }, 201);
      } catch (e) { console.error("masjid submit failed", e); return json({ ok: false, error: "Could not save mosque request", detail: String((e && e.message) || e).slice(0, 200) }, 500); }
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      if (!await isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      const rows = await env.DB.prepare("SELECT email,user_id,created_at,last_login_at,login_count FROM users ORDER BY last_login_at DESC LIMIT 500").all();
      return json({ ok: true, users: rows.results || [] });
    }
    if (url.pathname === "/api/admin/mobile-users" && request.method === "GET") {
      if (!await isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      const rows = await env.DB.prepare("SELECT mobile,user_id,created_at,last_login_at,login_count FROM mobile_users ORDER BY last_login_at DESC LIMIT 500").all();
      return json({ ok: true, users: rows.results || [] });
    }
    if (url.pathname === "/api/admin/masjid-requests" && request.method === "GET") {
      if (!await isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      const rows = await env.DB.prepare("SELECT * FROM masjid_submissions WHERE status='pending' ORDER BY submitted_at ASC LIMIT 200").all();
      return json({ ok: true, requests: (rows.results || []).map(x => ({ ...x, duplicate_candidates: JSON.parse(x.duplicate_candidates || "[]") })) });
    }
    if (url.pathname === "/api/admin/masjid-decision" && request.method === "POST") {
      if (!await isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      let body; try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid JSON" }, 400);
      const requestId = clean(body.requestId), decision = clean(body.decision), note = clean(body.note);
      if (!requestId || !["approve", "reject"].includes(decision)) return json({ ok: false, error: "requestId and approve/reject decision required" }, 400);
      const req = await env.DB.prepare("SELECT * FROM masjid_submissions WHERE request_id=? AND status='pending'").bind(requestId).first();
      if (!req) return json({ ok: false, error: "Pending request not found" }, 404);
      const now = new Date().toISOString();
      if (decision === "reject") {
        await env.DB.prepare("UPDATE masjid_submissions SET status='rejected', reviewed_at=?, review_note=? WHERE request_id=?").bind(now, note, requestId).run();
        return json({ ok: true, status: "rejected", requestId });
      }
      const candidates = await duplicateCandidates(env.DB, req, requestId);
      if (candidates.length && body.force !== true) return json({ ok: false, error: "Possible duplicate found. Review candidates; set force=true only if this is a genuinely separate mosque.", duplicateCandidates: candidates }, 409);
      const cityCode = normalize(req.city).replace(/\s/g, "").slice(0, 8).toUpperCase() || "GLOBAL";
      const masjidId = `BST-${cityCode}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const exRow = await env.DB.prepare("SELECT extra FROM submission_extra WHERE request_id=?").bind(requestId).first();
      let ex = {}; try { ex = JSON.parse((exRow && exRow.extra) || "{}"); } catch {}
      const dt = ex.details || {}, tm = ex.times || {};
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO masjids (masjid_id,name,normalized_name,owner_email,address,city,normalized_city,pincode,phone,description,lat,lon,source_request_id,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?)`)
          .bind(masjidId, req.name, req.normalized_name, req.owner_email, req.address, req.city, req.normalized_city, req.pincode, req.phone, req.description, req.lat, req.lon, requestId, now, now),
        env.DB.prepare("INSERT INTO masjid_details (masjid_id,address2,email,website,maktab,women_area,fiqh,capacity,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(masjidId, dt.address2 || "", dt.email || "", dt.website || "", dt.maktab ? 1 : 0, dt.women_area ? 1 : 0, dt.fiqh || "", dt.capacity ?? null, now),
        env.DB.prepare("INSERT INTO jamaat_times (masjid_id,fajr,zohar,asr,magrib,isha,juma,updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind(masjidId, tm.fajr ?? null, tm.zohar ?? null, tm.asr ?? null, tm.magrib ?? null, tm.isha ?? null, tm.juma ?? null, now),
        env.DB.prepare("UPDATE masjid_submissions SET status='approved', reviewed_at=?, review_note=? WHERE request_id=?").bind(now, note, requestId)
      ]);
      return json({ ok: true, status: "approved", masjidId, requestId });
    }
    if (url.pathname === "/api/admin/masjid-reports" && request.method === "GET") {
      if (!await isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      const rows = await env.DB.prepare("SELECT r.*, m.name AS masjid_name FROM masjid_reports r LEFT JOIN masjids m ON m.masjid_id=r.masjid_id WHERE r.status='open' ORDER BY r.submitted_at ASC LIMIT 200").all();
      return json({ ok: true, reports: rows.results || [] });
    }
    if (url.pathname === "/api/admin/report-resolve" && request.method === "POST") {
      if (!await isAdmin(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      let body; try { body = await request.json(); } catch { body = null; }
      const reportId = clean(body && body.reportId);
      if (!reportId) return json({ ok: false, error: "reportId required" }, 400);
      const r = await env.DB.prepare("UPDATE masjid_reports SET status='resolved', resolved_at=? WHERE report_id=? AND status='open'").bind(new Date().toISOString(), reportId).run();
      return json({ ok: true, changed: r.meta ? r.meta.changes : undefined });
    }

    // Owner edit: only the email that owns the approved mosque may change details / jamaat times.
    // NOTE: emails are not verified (same as login), so this is a basic check, not strong security.
    if (url.pathname === "/api/masjids/edit" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid JSON" }, 400);
      const masjidId = clean(body.masjidId), ownerEmail = clean(body.ownerEmail).toLowerCase();
      const m = await env.DB.prepare("SELECT masjid_id,owner_email FROM masjids WHERE masjid_id=? AND status='approved'").bind(masjidId).first();
      if (!m) return json({ ok: false, error: "Mosque not found" }, 404);
      if (m.owner_email !== ownerEmail) return json({ ok: false, error: "Only the mosque owner email can edit. Use Report to suggest a correction." }, 403);
      const ex = parseExtras(body); if (ex.error) return json({ ok: false, error: ex.error }, 400);
      const phone = "phone" in body ? clean(body.phone).slice(0, 30) : null, desc = "description" in body ? clean(body.description).slice(0, 500) : null;
      const now = new Date().toISOString();
      const cd = (await env.DB.prepare("SELECT * FROM masjid_details WHERE masjid_id=?").bind(masjidId).first()) || {};
      const ct = (await env.DB.prepare("SELECT * FROM jamaat_times WHERE masjid_id=?").bind(masjidId).first()) || {};
      const d = { ...cd, ...ex.details }, t = { ...ct, ...ex.times };
      try {
        await env.DB.batch([
          env.DB.prepare("UPDATE masjids SET phone=COALESCE(?,phone), description=COALESCE(?,description), updated_at=? WHERE masjid_id=?").bind(phone, desc, now, masjidId),
          env.DB.prepare("INSERT OR REPLACE INTO masjid_details (masjid_id,address2,email,website,maktab,women_area,fiqh,capacity,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(masjidId, d.address2 ?? "", d.email ?? "", d.website ?? "", d.maktab ? 1 : 0, d.women_area ? 1 : 0, d.fiqh ?? "", d.capacity ?? null, now),
          env.DB.prepare("INSERT OR REPLACE INTO jamaat_times (masjid_id,fajr,zohar,asr,magrib,isha,juma,updated_at) VALUES (?,?,?,?,?,?,?,?)")
            .bind(masjidId, t.fajr ?? null, t.zohar ?? null, t.asr ?? null, t.magrib ?? null, t.isha ?? null, t.juma ?? null, now)
        ]);
        return json({ ok: true, masjidId, updatedAt: now });
      } catch (e) { console.error("masjid edit failed", e); return json({ ok: false, error: "Could not save changes" }, 500); }
    }

    // Report a problem (wrong info, closed, duplicate, wrong location). Reviewed in the admin panel.
    if (url.pathname === "/api/masjids/report" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid JSON" }, 400);
      const masjidId = clean(body.masjidId), reason = clean(body.reason);
      if (!["wrong_info", "wrong_location", "closed", "duplicate", "other"].includes(reason)) return json({ ok: false, error: "reason must be wrong_info, wrong_location, closed, duplicate or other" }, 400);
      const m = await env.DB.prepare("SELECT masjid_id FROM masjids WHERE masjid_id=?").bind(masjidId).first();
      if (!m) return json({ ok: false, error: "Mosque not found" }, 404);
      const reportId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO masjid_reports (report_id,masjid_id,reason,details,reporter,submitted_at) VALUES (?,?,?,?,?,?)")
        .bind(reportId, masjidId, reason, clean(body.details).slice(0, 500), clean(body.reporter).slice(0, 254), new Date().toISOString()).run();
      return json({ ok: true, reportId }, 201);
    }

    // Nearby: /api/masjids/nearby?lat=..&lon=..&radius=3000&limit=50 (radius in metres), nearest first, with jamaat times.
    if (url.pathname === "/api/masjids/nearby" && request.method === "GET") {
      const p = url.searchParams, lat = Number(p.get("lat")), lon = Number(p.get("lon"));
      if (!p.get("lat") || !p.get("lon") || !validCoords(lat, lon)) return json({ ok: false, error: "Valid lat and lon required" }, 400);
      const radius = Math.min(Math.max(Number(p.get("radius")) || 3000, 100), 50000), limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 100);
      const dLat = radius / 111320, dLon = radius / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
      const rows = await env.DB.prepare(MASJID_SELECT + " WHERE m.status='approved' AND m.lat BETWEEN ? AND ? AND m.lon BETWEEN ? AND ? LIMIT 500")
        .bind(lat - dLat, lat + dLat, lon - dLon, lon + dLon).all();
      const out = (rows.results || []).map(r => ({ ...shapeMasjid(r), distance_m: Math.round(distanceMeters(lat, lon, r.lat, r.lon)) }))
        .filter(x => x.distance_m <= radius).sort((a, b) => a.distance_m - b.distance_m).slice(0, limit);
      return json({ ok: true, masjids: out });
    }

    const one = url.pathname.match(/^\/api\/masjids\/(BST-[A-Za-z0-9-]+)$/);
    if (one && request.method === "GET") {
      const r = await env.DB.prepare(MASJID_SELECT + " WHERE m.masjid_id=? AND m.status='approved'").bind(one[1]).first();
      return r ? json({ ok: true, masjid: shapeMasjid(r) }) : json({ ok: false, error: "Mosque not found" }, 404);
    }

    if (url.pathname === "/api/masjids" && request.method === "GET") {
      const rows = await env.DB.prepare(MASJID_SELECT + " WHERE m.status='approved' ORDER BY m.name LIMIT 500").all();
      return json({ ok: true, masjids: (rows.results || []).map(shapeMasjid) });
    }
    return json({ ok: false, error: "Not found" }, 404);
  }
};
