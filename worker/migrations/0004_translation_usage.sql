-- Extend the daily usage counter to support a separately metered translation feature.
-- Preserve every existing AI and assistant counter during the table rebuild.
CREATE TABLE usage_counters_new (
  user_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('ai', 'agent', 'translate')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, usage_day, usage_type)
);
INSERT INTO usage_counters_new (user_id, usage_day, usage_type, count)
SELECT user_id, usage_day, usage_type, count FROM usage_counters;
DROP TABLE usage_counters;
ALTER TABLE usage_counters_new RENAME TO usage_counters;
CREATE INDEX IF NOT EXISTS idx_usage_counters_day ON usage_counters(usage_day);
