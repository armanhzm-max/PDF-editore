CREATE TABLE IF NOT EXISTS feedback_submissions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'usability', 'other')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 3000),
  contact TEXT,
  locale TEXT,
  page_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_category_created ON feedback_submissions(category, created_at DESC);
