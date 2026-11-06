CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  user_id TEXT NOT NULL,
  logged_in_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_events_email ON login_events(email);
CREATE INDEX IF NOT EXISTS idx_login_events_time ON login_events(logged_in_at);
