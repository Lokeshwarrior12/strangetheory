CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  interests_json TEXT NOT NULL DEFAULT '[]',
  synapse_total INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member',
  badges_json TEXT NOT NULL DEFAULT '[]',
  banned INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  daily_digest_enabled INTEGER NOT NULL DEFAULT 1,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  reading_goal_per_week INTEGER NOT NULL DEFAULT 3,
  favorite_category_ids_json TEXT NOT NULL DEFAULT '[]',
  weekly_digest_enabled INTEGER NOT NULL DEFAULT 0,
  last_weekly_digest_at TEXT,
  google_sub TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  brain_region TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL,
  position_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  cover_url TEXT,
  intro TEXT NOT NULL,
  body_json TEXT NOT NULL,
  perspective TEXT NOT NULL DEFAULT 'Present',
  thinking_style TEXT NOT NULL DEFAULT 'Speculative',
  status TEXT NOT NULL DEFAULT 'draft',
  reading_minutes INTEGER NOT NULL DEFAULT 1,
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  ai_disclosure TEXT,
  category_ids_json TEXT NOT NULL,
  forked_from_id TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  insights_count INTEGER NOT NULL DEFAULT 0,
  bookmarks_count INTEGER NOT NULL DEFAULT 0,
  is_seed INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS riddles (
  post_id TEXT PRIMARY KEY,
  difficulty TEXT NOT NULL,
  riddle_type TEXT NOT NULL,
  hints_json TEXT NOT NULL,
  reveal_mode TEXT NOT NULL DEFAULT 'auto',
  reveal_at TEXT NOT NULL,
  revealed INTEGER NOT NULL DEFAULT 0,
  accepted_comment_id TEXT
);

CREATE TABLE IF NOT EXISTS riddle_secrets (
  post_id TEXT PRIMARY KEY,
  answer_text TEXT NOT NULL,
  answer_keywords_json TEXT NOT NULL,
  explanation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  lens TEXT NOT NULL,
  parent_id TEXT,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  is_accepted INTEGER NOT NULL DEFAULT 0,
  likely_correct INTEGER NOT NULL DEFAULT 0,
  upvotes INTEGER NOT NULL DEFAULT 0,
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS riddle_attempts (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  hints_used INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  show_all INTEGER NOT NULL DEFAULT 0,
  solved_at TEXT,
  started_at TEXT,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id, kind)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  points INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT NOT NULL,
  read_at TEXT,
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mod_actions (
  id TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reviewer_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mind_change_votes (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  before_score INTEGER,
  after_score INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  new_email TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  route TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  action_url TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_assets (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  day_key TEXT PRIMARY KEY,
  experiment_id TEXT,
  riddle_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  last_section TEXT NOT NULL DEFAULT '',
  reads_count INTEGER NOT NULL DEFAULT 1,
  first_read_at TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL,
  viewer_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, viewer_key)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, post_id)
);

CREATE TABLE IF NOT EXISTS weekly_challenges (
  week_key TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
