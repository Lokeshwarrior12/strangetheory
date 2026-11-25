CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posts_status_type ON posts(status, type);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status_type_published ON posts(status, type, published_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_status_date ON posts(author_id, status, published_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_post_lens ON comments(post_id, lens, status);
CREATE INDEX IF NOT EXISTS idx_comments_post_lens_status_created ON comments(post_id, lens, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reactions_target_kind ON reactions(target_type, target_id, kind);
CREATE INDEX IF NOT EXISTS idx_reactions_user_target ON reactions(user_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_riddle_attempts_post_solved ON riddle_attempts(post_id, solved_at, started_at);
CREATE INDEX IF NOT EXISTS idx_riddle_attempts_user_solved ON riddle_attempts(user_id, solved_at);

CREATE INDEX IF NOT EXISTS idx_ledger_user_time ON points_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_user_action ON rate_events(user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs(job_name, started_at DESC);
