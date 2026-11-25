CREATE INDEX IF NOT EXISTS idx_ledger_created ON points_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_lens_parent ON comments(post_id, lens, parent_id, status, created_at DESC);
