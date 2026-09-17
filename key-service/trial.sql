CREATE TABLE IF NOT EXISTS trial_activations (
  key_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_checked_at TEXT,
  PRIMARY KEY (key_id, device_id)
);
