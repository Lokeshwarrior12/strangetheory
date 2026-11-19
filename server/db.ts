import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { CATEGORIES, CATEGORY_BY_ID } from '../src/lib/categories';
import { calculateMindChangeStats, calculateTrendingScore, getIsoWeekKey } from '../src/lib/scoring';
import { validatePasswordStrength } from '../src/lib/passwords';
import { createSeedData, hashPassword } from './seed';
import { dispatchEmail, type OutboundEmail } from './email';
import type {
  Comment,
  EnrichedComment,
  EnrichedPost,
  MindChangeSummary,
  Post,
  Profile,
  ReactionKind,
  RiddlePublic,
  RiddleSecret,
} from '../src/lib/types';

export interface DbQueryRunner {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | null>;
  executeSql: (sql: string, params?: unknown[]) => Promise<void>;
}

let _pool: Pool | null = null;
let _pglite: PGlite | null = null;
let _initPromise: Promise<void> | null = null;
let _activeTargetKey: string | null = null;

function resolveDbConfig(): { mode: 'pg'; connectionString: string; key: string } | { mode: 'pglite'; dataDir: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return { mode: 'pg', connectionString: databaseUrl, key: `pg:${databaseUrl}` };
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL environment variable is required in production (e.g., Neon or Supabase PostgreSQL).'
    );
  }
  if (process.env.STRANGETHEORY_DB_MEMORY === '1') {
    return { mode: 'pglite', dataDir: 'memory://', key: 'pglite:memory://' };
  }
  const customDir = process.env.STRANGETHEORY_DB_PATH?.trim();
  if (customDir) {
    return { mode: 'pglite', dataDir: customDir, key: `pglite:${customDir}` };
  }
  if (process.env.NODE_TEST_CONTEXT) {
    return { mode: 'pglite', dataDir: 'memory://', key: 'pglite:memory://test' };
  }
  const defaultDir = path.resolve(process.cwd(), 'data', 'pglite');
  return { mode: 'pglite', dataDir: defaultDir, key: `pglite:${defaultDir}` };
}

export function getDbEngineName(): 'postgres' | 'pglite' {
  return process.env.DATABASE_URL?.trim() ? 'postgres' : 'pglite';
}

export async function closeDb(): Promise<void> {
  _initPromise = null;
  _activeTargetKey = null;
  if (_pool) {
    try {
      await _pool.end();
    } catch {
      // ignore
    }
    _pool = null;
  }
  if (_pglite) {
    try {
      await _pglite.close();
    } catch {
      // ignore
    }
    _pglite = null;
  }
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    brain_region TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL,
    position_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status_type ON posts(status, type)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at)`,
  `CREATE TABLE IF NOT EXISTS riddles (
    post_id TEXT PRIMARY KEY,
    difficulty TEXT NOT NULL,
    riddle_type TEXT NOT NULL,
    hints_json TEXT NOT NULL,
    reveal_mode TEXT NOT NULL DEFAULT 'auto',
    reveal_at TEXT NOT NULL,
    revealed INTEGER NOT NULL DEFAULT 0,
    accepted_comment_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS riddle_secrets (
    post_id TEXT PRIMARY KEY,
    answer_text TEXT NOT NULL,
    answer_keywords_json TEXT NOT NULL,
    explanation TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_post_lens ON comments(post_id, lens, status)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)`,
  `CREATE TABLE IF NOT EXISTS riddle_attempts (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    hints_used INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT,
    show_all INTEGER NOT NULL DEFAULT 0,
    solved_at TEXT,
    started_at TEXT,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, post_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, target_type, target_id, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, post_id)
  )`,
  `CREATE TABLE IF NOT EXISTS points_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    points INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user_time ON points_ledger(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    href TEXT NOT NULL,
    read_at TEXT,
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mod_actions (
    id TEXT PRIMARY KEY,
    moderator_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS appeals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reviewer_note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mind_change_votes (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    before_score INTEGER,
    after_score INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, post_id)
  )`,
  `CREATE TABLE IF NOT EXISTS email_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    new_email TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rate_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rate_user_action ON rate_events(user_id, action, created_at)`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGSERIAL PRIMARY KEY,
    event_name TEXT NOT NULL,
    route TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS error_logs (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT NOT NULL DEFAULT '',
    route TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_outbox (
    id TEXT PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    text TEXT NOT NULL,
    action_url TEXT NOT NULL,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS uploaded_assets (
    id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    data_base64 TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_snapshots (
    day_key TEXT PRIMARY KEY,
    experiment_id TEXT,
    riddle_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reading_progress (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    progress_pct INTEGER NOT NULL DEFAULT 0,
    last_section TEXT NOT NULL DEFAULT '',
    reads_count INTEGER NOT NULL DEFAULT 1,
    first_read_at TEXT NOT NULL,
    last_read_at TEXT NOT NULL,
    PRIMARY KEY (user_id, post_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id, last_read_at)`,
  `CREATE TABLE IF NOT EXISTS post_views (
    post_id TEXT NOT NULL,
    viewer_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, viewer_key)
  )`,
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id)`,
  `CREATE TABLE IF NOT EXISTS collection_items (
    collection_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, post_id)
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_challenges (
    week_key TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

const SCHEMA_MIGRATIONS: string[] = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS reading_goal_per_week INTEGER NOT NULL DEFAULT 3',
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_category_ids_json TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_digest_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_weekly_digest_at TEXT',
  'ALTER TABLE riddle_attempts ADD COLUMN IF NOT EXISTS started_at TEXT',
  'ALTER TABLE riddle_attempts ADD COLUMN IF NOT EXISTS points_awarded INTEGER NOT NULL DEFAULT 0',
];

function wrapPgRunner(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): DbQueryRunner {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await client.query(sql, params);
      return res.rows as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
      const res = await client.query(sql, params);
      return (res.rows[0] as T | undefined) ?? null;
    },
    async executeSql(sql: string, params: unknown[] = []): Promise<void> {
      await client.query(sql, params);
    },
  };
}

async function rawQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (_pool) {
    const res = await _pool.query(sql, params);
    return res.rows as T[];
  }
  if (_pglite) {
    const res = await _pglite.query<T>(sql, params);
    return res.rows;
  }
  throw new Error('Database not initialized.');
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureDbReady();
  return rawQuery<T>(sql, params);
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function executeSql(sql: string, params: unknown[] = []): Promise<void> {
  await ensureDbReady();
  await rawQuery(sql, params);
}

export async function withTransaction<T>(fn: (tx: DbQueryRunner) => Promise<T>): Promise<T> {
  await ensureDbReady();
  if (_pool) {
    const client: PoolClient = await _pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrapPgRunner(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }
  if (_pglite) {
    return _pglite.transaction(async (tx) => fn(wrapPgRunner(tx as unknown as PoolClient)));
  }
  throw new Error('Database not initialized.');
}

async function runSchemaAndSeed(): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await rawQuery(stmt);
  }
  for (const mig of SCHEMA_MIGRATIONS) {
    await rawQuery(mig);
  }
  for (const cat of CATEGORIES) {
    await rawQuery(
      `INSERT INTO categories (id, name, slug, brain_region, color, description, position_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [cat.id, cat.name, cat.slug, cat.brain_region, cat.color, cat.description, JSON.stringify(cat.position)]
    );
  }

  if (process.env.STRANGETHEORY_SKIP_SEED !== '1') {
    await seedIfEmptyInternal();
  }
  await bootstrapEnvAdminInternal();
}

export async function ensureDbReady(): Promise<void> {
  const cfg = resolveDbConfig();
  if (_initPromise && _activeTargetKey === cfg.key) {
    return _initPromise;
  }
  if (_activeTargetKey && _activeTargetKey !== cfg.key) {
    await closeDb();
  }

  _activeTargetKey = cfg.key;
  _initPromise = (async () => {
    if (cfg.mode === 'pg') {
      const isLocal = /localhost|127\.0\.0\.1/.test(cfg.connectionString);
      _pool = new Pool({
        connectionString: cfg.connectionString,
        max: Number(process.env.PG_POOL_MAX || 5),
        ssl: isLocal ? false : { rejectUnauthorized: false },
      });
    } else {
      if (cfg.dataDir !== 'memory://') {
        const pgVersionFile = path.join(cfg.dataDir, 'PG_VERSION');
        const pgControlFile = path.join(cfg.dataDir, 'global', 'pg_control');
        if (fs.existsSync(cfg.dataDir) && fs.existsSync(pgVersionFile) && !fs.existsSync(pgControlFile)) {
          fs.rmSync(cfg.dataDir, { recursive: true, force: true });
        }
        if (!fs.existsSync(cfg.dataDir)) {
          fs.mkdirSync(cfg.dataDir, { recursive: true });
        }
      }
      try {
        _pglite = new PGlite(cfg.dataDir);
        await _pglite.waitReady;
      } catch (err) {
        if (cfg.dataDir !== 'memory://' && fs.existsSync(cfg.dataDir)) {
          try {
            await _pglite?.close();
          } catch {
            // ignore
          }
          _pglite = null;
          fs.rmSync(cfg.dataDir, { recursive: true, force: true });
          fs.mkdirSync(cfg.dataDir, { recursive: true });
          _pglite = new PGlite(cfg.dataDir);
          await _pglite.waitReady;
        } else {
          throw err;
        }
      }
    }
    await runSchemaAndSeed();
  })();

  try {
    await _initPromise;
  } catch (err) {
    _initPromise = null;
    _activeTargetKey = null;
    if (_pglite) {
      try {
        await _pglite.close();
      } catch {
        // ignore
      }
      _pglite = null;
    }
    throw err;
  }
}

async function seedIfEmptyInternal(): Promise<void> {
  const rows = await rawQuery<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM users');
  if (Number(rows[0]?.cnt || 0) > 0) return;

  const seed = createSeedData();
  const authMap = new Map(seed.auth_users.map((u) => [u.id, u]));

  const runInsert = async (runner: DbQueryRunner) => {
    for (const p of seed.profiles) {
      const auth = authMap.get(p.id)!;
      await runner.executeSql(
        `INSERT INTO users (
          id, email, username, display_name, avatar_url, bio, interests_json,
          synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
          google_sub, password_hash, salt, is_seed, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $17)
        ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          auth.email,
          p.username,
          p.display_name,
          p.avatar_url || '',
          p.bio || '',
          JSON.stringify(p.interests || []),
          p.synapse_total || 0,
          p.role,
          JSON.stringify(p.badges || []),
          p.banned ? 1 : 0,
          auth.emailVerified ? 1 : 0,
          p.daily_digest_enabled === false ? 0 : 1,
          auth.googleSub || null,
          auth.passwordHash,
          auth.salt,
          p.created_at,
        ]
      );
    }

    for (const post of seed.posts) {
      await runner.executeSql(
        `INSERT INTO posts (
          id, author_id, type, title, slug, cover_url, intro, body_json,
          perspective, thinking_style, status, reading_minutes, ai_assisted, ai_disclosure,
          category_ids_json, forked_from_id, views, comments_count, insights_count, bookmarks_count,
          is_seed, published_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 1, $21, $22, $23)
        ON CONFLICT (id) DO NOTHING`,
        [
          post.id,
          post.author_id,
          post.type,
          post.title,
          post.slug,
          post.cover_url,
          post.intro,
          JSON.stringify(post.body_json),
          post.perspective,
          post.thinking_style,
          post.status,
          post.reading_minutes,
          post.ai_assisted ? 1 : 0,
          post.ai_disclosure,
          JSON.stringify(post.category_ids),
          post.forked_from_id || null,
          post.counts.views,
          post.counts.comments,
          post.counts.insights,
          post.counts.bookmarks,
          post.published_at,
          post.created_at,
          post.updated_at,
        ]
      );
    }

    for (const r of seed.riddles) {
      await runner.executeSql(
        `INSERT INTO riddles (post_id, difficulty, riddle_type, hints_json, reveal_mode, reveal_at, revealed, accepted_comment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (post_id) DO NOTHING`,
        [
          r.post_id,
          r.difficulty,
          r.riddle_type,
          JSON.stringify(r.hints),
          r.reveal_mode || 'auto',
          r.reveal_at,
          r.revealed ? 1 : 0,
          r.accepted_comment_id,
        ]
      );
    }

    for (const s of seed.riddle_secrets) {
      await runner.executeSql(
        `INSERT INTO riddle_secrets (post_id, answer_text, answer_keywords_json, explanation)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (post_id) DO NOTHING`,
        [s.post_id, s.answer_text, JSON.stringify(s.answer_keywords), s.explanation]
      );
    }
  };

  if (_pool) {
    const client = await _pool.connect();
    try {
      await client.query('BEGIN');
      await runInsert(wrapPgRunner(client));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } else if (_pglite) {
    await _pglite.transaction(async (tx) => runInsert(wrapPgRunner(tx as unknown as PoolClient)));
  }
}

async function bootstrapEnvAdminInternal(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!email || !password) return;

  const existingAdmin = await rawQuery<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existingAdmin.length > 0) return;

  const username = (process.env.ADMIN_USERNAME?.trim() || 'admin')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 24);
  if (validatePasswordStrength(password, { email, username })) {
    console.warn('SECURITY WARNING: ADMIN_PASSWORD does not meet strength requirements (min 10 chars); bootstrap skipped.');
    return;
  }

  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || 'Observatory Admin';
  const existingUsers = await rawQuery<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1',
    [email, username.toLowerCase()]
  );

  if (existingUsers[0]) {
    await rawQuery("UPDATE users SET role = 'admin', email_verified = 1 WHERE id = $1", [existingUsers[0].id]);
    return;
  }

  const { hash, salt } = hashPassword(password);
  const userId = `user-admin-${Date.now()}`;
  await rawQuery(
    `INSERT INTO users (
      id, email, username, display_name, avatar_url, bio, interests_json,
      synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
      password_hash, salt, is_seed, created_at
    ) VALUES ($1, $2, $3, $4, '', 'StrangeTheory administrator.', '[]', 0, 'admin', '[]', 0, 1, 1, $5, $6, 0, $7)`,
    [userId, email, username, displayName, hash, salt, new Date().toISOString()]
  );
}

export async function purgeSeedData(): Promise<{ deletedPosts: number; deletedUsers: number }> {
  await ensureDbReady();
  return withTransaction(async (tx) => {
    const seedPosts = await tx.query<{ id: string }>('SELECT id FROM posts WHERE is_seed = 1');
    const seedPostIds = seedPosts.map((p) => p.id);
    const seedUsers = await tx.query<{ id: string }>('SELECT id FROM users WHERE is_seed = 1');

    for (const pid of seedPostIds) {
      await tx.executeSql("DELETE FROM reactions WHERE target_type = 'post' AND target_id = $1", [pid]);
      await tx.executeSql('DELETE FROM bookmarks WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM mind_change_votes WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM riddle_attempts WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM riddle_secrets WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM riddles WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM comments WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM reading_progress WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM post_views WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM collection_items WHERE post_id = $1', [pid]);
      await tx.executeSql('DELETE FROM weekly_challenges WHERE post_id = $1', [pid]);
    }

    await tx.executeSql('DELETE FROM comments WHERE is_seed = 1');
    await tx.executeSql('DELETE FROM points_ledger WHERE is_seed = 1');
    await tx.executeSql('DELETE FROM notifications WHERE is_seed = 1');
    await tx.executeSql('DELETE FROM reports WHERE is_seed = 1');
    await tx.executeSql('DELETE FROM mod_actions WHERE is_seed = 1');
    await tx.executeSql('DELETE FROM posts WHERE is_seed = 1');

    for (const u of seedUsers) {
      const own = await tx.queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM posts WHERE author_id = $1', [u.id]);
      if (Number(own?.c || 0) === 0) {
        await tx.executeSql('DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1', [u.id]);
        await tx.executeSql('DELETE FROM users WHERE id = $1', [u.id]);
      }
    }

    return { deletedPosts: seedPostIds.length, deletedUsers: seedUsers.length };
  });
}

// --- Row Mappers ---
export function rowToProfile(row: Record<string, unknown>, includePrivate = false): Profile {
  const base: Profile = {
    id: String(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    avatar_url: String(row.avatar_url || ''),
    bio: String(row.bio || ''),
    interests: JSON.parse(String(row.interests_json || '[]')),
    synapse_total: Number(row.synapse_total || 0),
    role: String(row.role || 'member') as Profile['role'],
    badges: JSON.parse(String(row.badges_json || '[]')),
    banned: Boolean(row.banned),
    created_at: String(row.created_at),
  };
  if (includePrivate) {
    base.email = String(row.email || '');
    base.email_verified = Boolean(row.email_verified);
    base.daily_digest_enabled = Boolean(row.daily_digest_enabled);
    base.onboarding_completed = Boolean(row.onboarding_completed);
    base.reading_goal_per_week = Number(row.reading_goal_per_week || 3);
    base.favorite_category_ids = JSON.parse(String(row.favorite_category_ids_json || '[]'));
    base.weekly_digest_enabled = Boolean(row.weekly_digest_enabled);
  }
  return base;
}

export function rowToPost(row: Record<string, unknown>): Post {
  return {
    id: String(row.id),
    author_id: String(row.author_id),
    type: String(row.type) as Post['type'],
    title: String(row.title),
    slug: String(row.slug),
    cover_url: row.cover_url ? String(row.cover_url) : null,
    intro: String(row.intro),
    body_json: JSON.parse(String(row.body_json || '{}')),
    perspective: String(row.perspective || 'Present'),
    thinking_style: String(row.thinking_style || 'Speculative'),
    status: String(row.status) as Post['status'],
    reading_minutes: Number(row.reading_minutes || 1),
    ai_assisted: Boolean(row.ai_assisted),
    ai_disclosure: row.ai_disclosure ? String(row.ai_disclosure) : null,
    category_ids: JSON.parse(String(row.category_ids_json || '[]')),
    forked_from_id: row.forked_from_id ? String(row.forked_from_id) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    counts: {
      views: Number(row.views || 0),
      comments: Number(row.comments_count || 0),
      insights: Number(row.insights_count || 0),
      bookmarks: Number(row.bookmarks_count || 0),
    },
  };
}

export function rowToComment(row: Record<string, unknown>): Comment {
  return {
    id: String(row.id),
    post_id: String(row.post_id),
    lens: String(row.lens) as Comment['lens'],
    parent_id: row.parent_id ? String(row.parent_id) : null,
    author_id: String(row.author_id),
    body: String(row.body),
    status: String(row.status) as Comment['status'],
    is_accepted: Boolean(row.is_accepted),
    likely_correct: Boolean(row.likely_correct),
    upvotes: Number(row.upvotes || 0),
    created_at: String(row.created_at),
  };
}

export async function getUserById(userId: string, includePrivate = false): Promise<Profile | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [userId]);
  return row ? rowToProfile(row, includePrivate) : null;
}

export async function getPostById(postId: string): Promise<Post | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM posts WHERE id = $1', [postId]);
  return row ? rowToPost(row) : null;
}

export async function getRiddlePublic(postId: string): Promise<RiddlePublic | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM riddles WHERE post_id = $1', [postId]);
  if (!row) return null;
  return {
    post_id: String(row.post_id),
    difficulty: String(row.difficulty) as RiddlePublic['difficulty'],
    riddle_type: String(row.riddle_type) as RiddlePublic['riddle_type'],
    hints: JSON.parse(String(row.hints_json || '[]')),
    reveal_mode: String(row.reveal_mode || 'auto') as 'author' | 'auto',
    reveal_at: String(row.reveal_at),
    revealed: Boolean(row.revealed),
    accepted_comment_id: row.accepted_comment_id ? String(row.accepted_comment_id) : null,
  };
}

export async function getRiddleSecret(postId: string): Promise<RiddleSecret | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM riddle_secrets WHERE post_id = $1', [postId]);
  if (!row) return null;
  return {
    post_id: String(row.post_id),
    answer_text: String(row.answer_text),
    answer_keywords: JSON.parse(String(row.answer_keywords_json || '[]')),
    explanation: String(row.explanation),
  };
}

export async function awardSynapse(userId: string, reason: string, points: number, sourceId: string): Promise<void> {
  if (points === 0) return;
  const userExists = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);
  if (!userExists) return;

  await executeSql(
    `INSERT INTO points_ledger (id, user_id, reason, points, source_id, is_seed, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [
      `syn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId,
      reason,
      points,
      sourceId,
      new Date().toISOString(),
    ]
  );

  const row = await queryOne<{ total: number }>(
    'SELECT COALESCE(SUM(points), 0)::int AS total FROM points_ledger WHERE user_id = $1',
    [userId]
  );
  await executeSql('UPDATE users SET synapse_total = $1 WHERE id = $2', [Math.max(0, Number(row?.total || 0)), userId]);
}

export async function syncRiddleAutoReveal(postId: string): Promise<void> {
  const row = await queryOne<{ reveal_mode: string; reveal_at: string; revealed: number }>(
    'SELECT reveal_mode, reveal_at, revealed FROM riddles WHERE post_id = $1',
    [postId]
  );
  if (!row || row.revealed) return;
  if (row.reveal_mode !== 'author' && Date.now() >= new Date(row.reveal_at).getTime()) {
    await executeSql('UPDATE riddles SET revealed = 1 WHERE post_id = $1', [postId]);
  }
}

export async function getMindChangeSummary(postId: string, viewerId: string | null): Promise<MindChangeSummary> {
  const rows = await query<{ user_id: string; before_score: number | null; after_score: number | null }>(
    'SELECT user_id, before_score, after_score FROM mind_change_votes WHERE post_id = $1',
    [postId]
  );
  const stats = calculateMindChangeStats(rows);
  const mine = viewerId ? rows.find((r) => r.user_id === viewerId) : undefined;
  return {
    ...stats,
    user_before: mine?.before_score ?? null,
    user_after: mine?.after_score ?? null,
  };
}

export async function enrichPost(post: Post, viewerId: string | null): Promise<EnrichedPost> {
  const [authorRow, postReactions, bmRow, followRow, forkedRow, progressRow] = await Promise.all([
    queryOne<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [post.author_id]),
    query<{ user_id: string; kind: ReactionKind }>(
      "SELECT user_id, kind FROM reactions WHERE target_type = 'post' AND target_id = $1",
      [post.id]
    ),
    viewerId
      ? queryOne<{ one: number }>('SELECT 1 AS one FROM bookmarks WHERE user_id = $1 AND post_id = $2', [viewerId, post.id])
      : Promise.resolve(null),
    viewerId
      ? queryOne<{ one: number }>('SELECT 1 AS one FROM follows WHERE follower_id = $1 AND followee_id = $2', [
          viewerId,
          post.author_id,
        ])
      : Promise.resolve(null),
    post.forked_from_id
      ? queryOne<{ id: string; title: string; slug: string }>('SELECT id, title, slug FROM posts WHERE id = $1', [
          post.forked_from_id,
        ])
      : Promise.resolve(null),
    viewerId
      ? queryOne<{ progress_pct: number; last_section: string; last_read_at: string }>(
          'SELECT progress_pct, last_section, last_read_at FROM reading_progress WHERE user_id = $1 AND post_id = $2',
          [viewerId, post.id]
        )
      : Promise.resolve(null),
  ]);

  const author = authorRow
    ? rowToProfile(authorRow, false)
    : {
        id: post.author_id,
        username: 'unknown',
        display_name: 'StrangeTheory Member',
        avatar_url: '',
        bio: '',
        interests: [],
        synapse_total: 0,
        role: 'member' as const,
        badges: [],
        created_at: post.created_at,
      };

  const categories = post.category_ids
    .map((id) => CATEGORY_BY_ID.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const reaction_counts: Record<ReactionKind, number> = {
    mind_blown: 0,
    strong_logic: 0,
    needs_evidence: 0,
    changed_mind: 0,
  };
  for (const r of postReactions) {
    reaction_counts[r.kind] = (reaction_counts[r.kind] || 0) + 1;
  }
  const user_reactions = viewerId
    ? postReactions.filter((r) => r.user_id === viewerId).map((r) => r.kind)
    : [];

  const refTime = post.published_at || post.created_at;
  const ageHours = Math.max(0, (Date.now() - new Date(refTime).getTime()) / 3600_000);
  const trending_score = calculateTrendingScore({
    views: post.counts.views,
    insights: post.counts.insights,
    comments: post.counts.comments,
    bookmarks: post.counts.bookmarks,
    ageHours,
  });

  const base: EnrichedPost = {
    ...post,
    author: {
      id: author.id,
      username: author.username,
      display_name: author.display_name,
      avatar_url: author.avatar_url,
      synapse_total: author.synapse_total,
      role: author.role,
      badges: author.badges,
    },
    categories,
    reaction_counts,
    user_reactions,
    is_bookmarked: Boolean(bmRow),
    is_following_author: Boolean(followRow),
    trending_score,
    mind_change: post.type === 'experiment' ? await getMindChangeSummary(post.id, viewerId) : undefined,
    forked_from_post: forkedRow,
    reading_progress: progressRow
      ? {
          progress_pct: Number(progressRow.progress_pct || 0),
          last_section: String(progressRow.last_section || ''),
          last_read_at: String(progressRow.last_read_at),
        }
      : null,
  };

  if (post.type === 'riddle') {
    await syncRiddleAutoReveal(post.id);
    const riddle = await getRiddlePublic(post.id);
    if (riddle) {
      const attemptRow = viewerId
        ? await queryOne<Record<string, unknown>>(
            'SELECT * FROM riddle_attempts WHERE user_id = $1 AND post_id = $2',
            [viewerId, post.id]
          )
        : null;
      const hintsUsed = attemptRow ? Number(attemptRow.hints_used || 0) : 0;
      const isAuthor = viewerId === post.author_id;
      const revealedHints = isAuthor || riddle.revealed ? riddle.hints : riddle.hints.slice(0, hintsUsed);

      // CRITICAL SECURITY BOUNDARY: Never expose hints beyond hints_used unless author or revealed.
      base.riddle = {
        ...riddle,
        hints: revealedHints,
        total_hints: riddle.hints.length,
      } as RiddlePublic & { total_hints: number };

      base.riddle_attempt = {
        hints_used: hintsUsed,
        revealed_hints: revealedHints,
        answers_unlocked: Boolean(isAuthor || riddle.revealed || attemptRow?.submitted_at || attemptRow?.show_all),
        has_submitted: Boolean(attemptRow?.submitted_at),
        solved: Boolean(attemptRow?.solved_at),
        points_awarded: attemptRow?.points_awarded ? Number(attemptRow.points_awarded) : undefined,
      };

      // CRITICAL SECURITY BOUNDARY: Never include riddle_secret unless revealed or viewer is the author.
      if (isAuthor || riddle.revealed) {
        const secret = await getRiddleSecret(post.id);
        if (secret) {
          base.riddle_secret = {
            answer_text: secret.answer_text,
            explanation: secret.explanation,
            ...(isAuthor ? { answer_keywords: secret.answer_keywords } : {}),
          };
        }
      } else {
        base.riddle_secret = null;
      }
    }
  }

  return base;
}

export async function enrichComment(
  comment: Comment,
  viewerId: string | null,
  isRiddleAuthor: boolean
): Promise<EnrichedComment> {
  const [authorRow, rxns] = await Promise.all([
    queryOne<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [comment.author_id]),
    query<{ user_id: string; kind: ReactionKind }>(
      "SELECT user_id, kind FROM reactions WHERE target_type = 'comment' AND target_id = $1",
      [comment.id]
    ),
  ]);
  const author = authorRow ? rowToProfile(authorRow, false) : null;

  const reaction_counts: Record<ReactionKind, number> = {
    mind_blown: 0,
    strong_logic: 0,
    needs_evidence: 0,
    changed_mind: 0,
  };
  for (const r of rxns) {
    reaction_counts[r.kind] = (reaction_counts[r.kind] || 0) + 1;
  }
  const user_reactions = viewerId ? rxns.filter((r) => r.user_id === viewerId).map((r) => r.kind) : [];

  return {
    ...comment,
    // Hide likely_correct hint from non-authors so it doesn't leak confirmation before author marks it
    likely_correct: isRiddleAuthor ? comment.likely_correct : false,
    author: author
      ? {
          id: author.id,
          username: author.username,
          display_name: author.display_name,
          avatar_url: author.avatar_url,
          synapse_total: author.synapse_total,
          role: author.role,
        }
      : {
          id: comment.author_id,
          username: 'deleted_user',
          display_name: 'Former Member',
          avatar_url: '',
          synapse_total: 0,
          role: 'member',
        },
    reaction_counts,
    user_reactions,
    insights_total: rxns.length,
  };
}

export async function recordOutboxEmail(entry: OutboundEmail): Promise<void> {
  await executeSql(
    `INSERT INTO email_outbox (id, to_email, subject, text, action_url, provider, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.id, entry.to_email, entry.subject, entry.text, entry.action_url, entry.provider, entry.created_at]
  );
}

export async function logServerError(source: string, message: string, stack = '', route = ''): Promise<void> {
  try {
    await executeSql(
      'INSERT INTO error_logs (source, message, stack, route, created_at) VALUES ($1, $2, $3, $4, $5)',
      [source, message.slice(0, 500), stack.slice(0, 2000), route.slice(0, 200), new Date().toISOString()]
    );
  } catch {
    // ignore logging failure
  }
}

export function signWeeklyDigestUnsubscribeToken(userId: string): string {
  const secret = process.env.SESSION_SECRET || 'strangetheory_local_session_secret_key_2026';
  const payload = `unsub.${userId}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${userId}.${sig}`;
}

export function verifyWeeklyDigestUnsubscribeToken(token: string): string | null {
  const secret = process.env.SESSION_SECRET || 'strangetheory_local_session_secret_key_2026';
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const userId = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', secret).update(`unsub.${userId}`).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return userId;
}

export async function notifyRiddleAnswerersRevealed(post: { id: string; title: string; slug: string; author_id: string }): Promise<void> {
  const answerers = await query<{ user_id: string }>(
    'SELECT user_id FROM riddle_attempts WHERE post_id = $1 AND submitted_at IS NOT NULL',
    [post.id]
  );
  const nowIso = new Date().toISOString();
  for (const ans of answerers) {
    if (ans.user_id === post.author_id) continue;
    const notifId = `notif-rev-${post.id}-${ans.user_id}`;
    const exists = await queryOne<{ id: string }>('SELECT id FROM notifications WHERE id = $1', [notifId]);
    if (!exists) {
      await executeSql(
        `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
         VALUES ($1, $2, 'riddle_revealed', $3, $4, $5, NULL, 0, $6)`,
        [notifId, ans.user_id, 'Riddle solution revealed', post.title, `/riddle/${post.slug}`, nowIso]
      );
    }
  }
}

export async function getOrCreateWeeklyChallenge(now = new Date()): Promise<{
  weekKey: string;
  startsAt: string;
  endsAt: string;
  postId: string | null;
}> {
  await ensureDbReady();
  const { weekKey, startsAt, endsAt } = getIsoWeekKey(now);
  const existing = await queryOne<{ week_key: string; post_id: string; starts_at: string; ends_at: string }>(
    'SELECT * FROM weekly_challenges WHERE week_key = $1',
    [weekKey]
  );
  if (existing) {
    const p = await getPostById(existing.post_id);
    if (p && p.status === 'published' && p.type === 'riddle') {
      return { weekKey, startsAt: existing.starts_at, endsAt: existing.ends_at, postId: existing.post_id };
    }
  }

  const riddles = await query<{ id: string }>(
    "SELECT id FROM posts WHERE status = 'published' AND type = 'riddle' ORDER BY id ASC"
  );
  if (riddles.length === 0) {
    return { weekKey, startsAt, endsAt, postId: null };
  }
  const weekIdx = Math.floor(Date.parse(startsAt) / (7 * 86400_000));
  const picked = riddles[Math.abs(weekIdx) % riddles.length];
  await executeSql(
    `INSERT INTO weekly_challenges (week_key, post_id, starts_at, ends_at, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (week_key) DO UPDATE SET post_id = excluded.post_id`,
    [weekKey, picked.id, startsAt, endsAt, now.toISOString()]
  );
  return { weekKey, startsAt, endsAt, postId: picked.id };
}

export async function runWeeklyDigestDispatch(originBaseUrl?: string): Promise<number> {
  await ensureDbReady();
  const now = new Date();
  const nowIso = now.toISOString();
  const sevenDaysAgoIso = new Date(now.getTime() - 6.5 * 86400_000).toISOString();

  const origin = (originBaseUrl || (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL : 'http://localhost:3000')).replace(/\/$/, '');

  const [featuredExp, weeklyChallenge] = await Promise.all([
    queryOne<{ id: string; title: string; slug: string; intro: string }>(
      "SELECT id, title, slug, intro FROM posts WHERE status = 'published' AND type = 'experiment' ORDER BY insights_count DESC, views DESC, id ASC LIMIT 1"
    ),
    getOrCreateWeeklyChallenge(now),
  ]);
  const featuredRiddle = weeklyChallenge.postId
    ? await queryOne<{ id: string; title: string; slug: string; intro: string }>(
        'SELECT id, title, slug, intro FROM posts WHERE id = $1',
        [weeklyChallenge.postId]
      )
    : null;

  if (!featuredExp && !featuredRiddle) return 0;

  const subscribers = await query<{ id: string; email: string; display_name: string; synapse_total: number }>(
    `SELECT id, email, display_name, synapse_total FROM users
     WHERE weekly_digest_enabled = 1 AND email_verified = 1 AND banned = 0 AND is_seed = 0
       AND (last_weekly_digest_at IS NULL OR last_weekly_digest_at <= $1)`,
    [sevenDaysAgoIso]
  );

  let sentCount = 0;
  for (const sub of subscribers) {
    const readsRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM reading_progress WHERE user_id = $1', [sub.id]);
    const readsCount = Number(readsRow?.c || 0);
    const topStat = readsCount > 0 ? `${readsCount} entries explored on My Brain` : `${sub.synapse_total} Synapse earned`;

    const unsubToken = signWeeklyDigestUnsubscribeToken(sub.id);
    const unsubUrl = `${origin}/api/digest/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const primaryUrl = featuredExp ? `${origin}/post/${featuredExp.slug}` : `${origin}/riddle/${featuredRiddle!.slug}`;

    const lines = [
      `Hello ${sub.display_name}, here is your Weekly Synapse edition.`,
      featuredExp ? `Featured Thought Experiment: "${featuredExp.title}" — ${featuredExp.intro}` : '',
      featuredRiddle ? `Featured Weekly Riddle: "${featuredRiddle.title}" — ${origin}/riddle/${featuredRiddle.slug}` : '',
      `Your Top Stat: ${topStat}.`,
    ].filter(Boolean);

    await dispatchEmail({
      to: sub.email,
      subject: 'The Weekly Synapse — StrangeTheory',
      text: lines.join('\n\n'),
      actionUrl: primaryUrl,
      ctaLabel: 'Open This Week’s Feature',
      unsubscribeUrl: unsubUrl,
      recordOutbox: recordOutboxEmail,
    });

    await executeSql('UPDATE users SET last_weekly_digest_at = $1 WHERE id = $2', [nowIso, sub.id]);
    sentCount += 1;
  }

  return sentCount;
}

export async function runDailyMaintenance(originBaseUrl?: string): Promise<{
  dayKey: string;
  autoRevealedCount: number;
  experimentId: string | null;
  riddleId: string | null;
  digestNotificationsSent: number;
  weeklyChallengeWeekKey: string;
  weeklyEmailsSent: number;
}> {
  await ensureDbReady();
  const now = new Date();
  const nowIso = now.toISOString();
  const dayKey = nowIso.slice(0, 10);

  // 1. Auto-reveal expired riddles whose reveal_mode != 'author'
  const dueRiddles = await query<{ post_id: string }>(
    "SELECT post_id FROM riddles WHERE revealed = 0 AND reveal_mode != 'author' AND reveal_at <= $1",
    [nowIso]
  );
  if (dueRiddles.length > 0) {
    await executeSql(
      "UPDATE riddles SET revealed = 1 WHERE revealed = 0 AND reveal_mode != 'author' AND reveal_at <= $1",
      [nowIso]
    );
    for (const d of dueRiddles) {
      const p = await queryOne<{ id: string; title: string; slug: string; author_id: string }>(
        'SELECT id, title, slug, author_id FROM posts WHERE id = $1',
        [d.post_id]
      );
      if (p) await notifyRiddleAnswerersRevealed(p);
    }
  }

  // 2. Snapshot today's Daily Picks deterministically
  const existingSnapshot = await queryOne<{ experiment_id: string | null; riddle_id: string | null }>(
    'SELECT experiment_id, riddle_id FROM daily_snapshots WHERE day_key = $1',
    [dayKey]
  );

  let experimentId = existingSnapshot?.experiment_id ?? null;
  let riddleId = existingSnapshot?.riddle_id ?? null;
  let pickedExperimentTitle = '';

  if (!existingSnapshot) {
    const publishedExps = await query<{ id: string; title: string }>(
      "SELECT id, title FROM posts WHERE status = 'published' AND type = 'experiment' ORDER BY id ASC"
    );
    const publishedRiddles = await query<{ id: string; title: string }>(
      "SELECT id, title FROM posts WHERE status = 'published' AND type = 'riddle' ORDER BY id ASC"
    );
    const dayIndex = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400_000);
    const dailyExp = publishedExps.length ? publishedExps[dayIndex % publishedExps.length] : null;
    const dailyRid = publishedRiddles.length ? publishedRiddles[dayIndex % publishedRiddles.length] : null;
    experimentId = dailyExp?.id ?? null;
    riddleId = dailyRid?.id ?? null;
    pickedExperimentTitle = dailyExp?.title ?? 'Today’s StrangeTheory Pick';

    await executeSql(
      `INSERT INTO daily_snapshots (day_key, experiment_id, riddle_id, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (day_key) DO NOTHING`,
      [dayKey, experimentId, riddleId, nowIso]
    );
  } else if (experimentId) {
    const row = await queryOne<{ title: string }>('SELECT title FROM posts WHERE id = $1', [experimentId]);
    pickedExperimentTitle = row?.title ?? 'Today’s StrangeTheory Pick';
  }

  // 3. Idempotent daily digest notifications for subscribed verified users
  let digestNotificationsSent = 0;
  if (experimentId) {
    const subscribers = await query<{ id: string }>(
      "SELECT id FROM users WHERE daily_digest_enabled = 1 AND email_verified = 1 AND banned = 0 AND is_seed = 0"
    );
    const postRow = await queryOne<{ slug: string }>('SELECT slug FROM posts WHERE id = $1', [experimentId]);
    const href = postRow ? `/post/${postRow.slug}` : '/daily';
    for (const sub of subscribers) {
      const notifId = `digest-${dayKey}-${sub.id}`;
      const exists = await queryOne<{ id: string }>('SELECT id FROM notifications WHERE id = $1', [notifId]);
      if (!exists) {
        await executeSql(
          `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
           VALUES ($1, $2, 'digest_post', 'Daily StrangeTheory Pick', $3, $4, NULL, 0, $5)`,
          [notifId, sub.id, pickedExperimentTitle, href, nowIso]
        );
        digestNotificationsSent += 1;
      }
    }
  }

  // 4. Ensure weekly challenge snapshot & send Weekly Synapse email (max once per 7 days per subscriber)
  const weekly = await getOrCreateWeeklyChallenge(now);
  const weeklyEmailsSent = await runWeeklyDigestDispatch(originBaseUrl);

  return {
    dayKey,
    autoRevealedCount: dueRiddles.length,
    experimentId,
    riddleId,
    digestNotificationsSent,
    weeklyChallengeWeekKey: weekly.weekKey,
    weeklyEmailsSent,
  };
}

export async function saveFallbackUploadedAsset(id: string, mimeType: string, dataBase64: string): Promise<void> {
  await executeSql(
    'INSERT INTO uploaded_assets (id, mime_type, data_base64, created_at) VALUES ($1, $2, $3, $4)',
    [id, mimeType, dataBase64, new Date().toISOString()]
  );
}

export async function getFallbackUploadedAsset(id: string): Promise<{ mime_type: string; data_base64: string } | null> {
  return queryOne<{ mime_type: string; data_base64: string }>(
    'SELECT mime_type, data_base64 FROM uploaded_assets WHERE id = $1',
    [id]
  );
}
