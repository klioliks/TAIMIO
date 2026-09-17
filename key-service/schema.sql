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

CREATE TABLE IF NOT EXISTS trial_activations (
  key_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_checked_at TEXT,
  PRIMARY KEY (key_id, device_id)
);
