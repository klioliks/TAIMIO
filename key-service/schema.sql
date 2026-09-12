CREATE TABLE IF NOT EXISTS access_keys (
  key_id TEXT PRIMARY KEY,
  key_hash TEXT UNIQUE NOT NULL,
  key_masked TEXT NOT NULL,
  status TEXT NOT NULL,
  plan TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  expires_at TEXT,
  duration_days INTEGER NOT NULL DEFAULT 60,
  device_limit INTEGER NOT NULL DEFAULT 1,
  device_id TEXT,
  last_checked_at TEXT,
  notes TEXT
);
