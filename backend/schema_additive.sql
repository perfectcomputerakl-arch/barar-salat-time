-- BARAR SALAT TIME v1.3.0 additive migration.
-- Existing users and login_events tables are NOT dropped or altered.
CREATE TABLE IF NOT EXISTS mobile_users (
  mobile TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS mobile_login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile TEXT NOT NULL,
  user_id TEXT NOT NULL,
  logged_in_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_mobile_events_mobile ON mobile_login_events(mobile);
CREATE INDEX IF NOT EXISTS idx_mobile_events_time ON mobile_login_events(logged_in_at);

CREATE TABLE IF NOT EXISTS masjid_submissions (
  request_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  normalized_city TEXT NOT NULL,
  pincode TEXT,
  phone TEXT,
  description TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  duplicate_candidates TEXT NOT NULL DEFAULT '[]',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_masjid_submissions_status ON masjid_submissions(status);
CREATE INDEX IF NOT EXISTS idx_masjid_submissions_name_city ON masjid_submissions(normalized_name, normalized_city);

CREATE TABLE IF NOT EXISTS masjids (
  masjid_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  normalized_city TEXT NOT NULL,
  pincode TEXT,
  phone TEXT,
  description TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  source_request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_masjids_name_city ON masjids(normalized_name, normalized_city);
CREATE INDEX IF NOT EXISTS idx_masjids_owner_email ON masjids(owner_email);
