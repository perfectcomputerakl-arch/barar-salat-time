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
  `CREATE INDEX IF NOT EXISTS idx_masjids_owner_email ON masjids(owner_email)`
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
async function duplicateCandidates(db, item) {
  const rows = await db.prepare(`SELECT masjid_id AS id, name, city, lat, lon, 'approved' AS record_type FROM masjids
    UNION ALL SELECT request_id AS id, name, city, lat, lon, 'pending' AS record_type FROM masjid_submissions WHERE status='pending'`).all();
  return (rows.results || []).map(x => ({ ...x, distance_m: Math.round(distanceMeters(item.lat, item.lon, x.lat, x.lon)) }))
    .filter(x => x.distance_m <= 100 || (normalize(x.name) === item.normalized_name && normalize(x.city) === item.normalized_city))
    .slice(0, 10);
}
async function isAdmin(request, env) {
  return !!env.ADMIN_TOKEN && request.headers.get("X-Admin-Token") === env.ADMIN_TOKEN;
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if ((url.pathname === "/" || url.pathname === "/api/health") && request.method === "GET")
      return json({ ok: true, service: "BARAR SALAT TIME Backend", status: "Running", version: "1.3.1" });

    if (url.pathname.startsWith("/api/")) {
      try { await ensureSchema(env.DB); }
      catch (e) { console.error("schema setup failed", e); return json({ ok: false, error: "Database not ready", detail: String((e && e.message) || e).slice(0, 200) }, 500); }
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
        return json({ ok: true, requestId, status: "pending", duplicateCandidates: candidates, message: "Submitted for admin review. Not public until approved." }, 201);
      } catch { return json({ ok: false, error: "Could not save mosque request. Run schema_additive.sql first." }, 500); }
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
      const candidates = await duplicateCandidates(env.DB, req);
      if (candidates.length && body.force !== true) return json({ ok: false, error: "Possible duplicate found. Review candidates; set force=true only if this is a genuinely separate mosque.", duplicateCandidates: candidates }, 409);
      const cityCode = normalize(req.city).replace(/\s/g, "").slice(0, 8).toUpperCase() || "GLOBAL";
      const masjidId = `BST-${cityCode}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await env.DB.prepare(`INSERT INTO masjids (masjid_id,name,normalized_name,owner_email,address,city,normalized_city,pincode,phone,description,lat,lon,source_request_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?)`)
        .bind(masjidId, req.name, req.normalized_name, req.owner_email, req.address, req.city, req.normalized_city, req.pincode, req.phone, req.description, req.lat, req.lon, requestId, now, now).run();
      await env.DB.prepare("UPDATE masjid_submissions SET status='approved', reviewed_at=?, review_note=? WHERE request_id=?").bind(now, note, requestId).run();
      return json({ ok: true, status: "approved", masjidId, requestId });
    }
    if (url.pathname === "/api/masjids" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT masjid_id,name,address,city,pincode,lat,lon FROM masjids WHERE status='approved' ORDER BY name LIMIT 500").all();
      return json({ ok: true, masjids: rows.results || [] });
    }
    return json({ ok: false, error: "Not found" }, 404);
  }
};
