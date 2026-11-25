import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { CATEGORIES, CATEGORY_BY_ID } from '../src/lib/categories.js';
import { calculateMindChangeStats, calculateTrendingScore, getIsoWeekKey } from '../src/lib/scoring.js';
import { validatePasswordStrength } from '../src/lib/passwords.js';
import { createSeedData, hashPassword } from './seed.js';
import { dispatchEmail, type OutboundEmail } from './email.js';
import { applyVersionedMigrations } from './migrations.js';
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
} from '../src/lib/types.js';

export interface DbQueryRunner {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | null>;
  executeSql: (sql: string, params?: unknown[]) => Promise<void>;
}

interface PGliteLike {
  waitReady: Promise<void>;
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export class DbConfigError extends Error {
  status = 503;
  code = 'DB_CONFIG_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

export class DbUnreachableError extends Error {
  status = 503;
  code = 'DB_UNREACHABLE';
  constructor(message: string) {
    super(message);
    this.name = 'DbUnreachableError';
  }
}

export class DbMigrationsPendingError extends Error {
  status = 503;
  code = 'DB_MIGRATIONS_PENDING';
  constructor(message: string) {
    super(message);
    this.name = 'DbMigrationsPendingError';
  }
}

let _pool: Pool | null = null;
let _pglite: PGliteLike | null = null;
let _initPromise: Promise<void> | null = null;
let _activeTargetKey: string | null = null;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

export function normalizePostgresUrl(rawUrl: string): {
  connectionString: string;
  strippedChannelBinding: boolean;
} {
  try {
    const parsed = new URL(rawUrl);
    const hadChannelBinding = parsed.searchParams.has('channel_binding');
    if (hadChannelBinding) {
      parsed.searchParams.delete('channel_binding');
    }
    return {
      connectionString: parsed.toString(),
      strippedChannelBinding: hadChannelBinding,
    };
  } catch {
    return { connectionString: rawUrl, strippedChannelBinding: false };
  }
}

export function resolveMigrationConnectionString(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DIRECT_URL?.trim() || env.DATABASE_URL?.trim() || null;
}

export function shouldSkipMigration(env: NodeJS.ProcessEnv = process.env): { skip: boolean; reason?: string } {
  const isVercel = env.VERCEL === '1' || Boolean(env.VERCEL_ENV);
  const isProd = env.NODE_ENV === 'production';

  if (isVercel && env.VERCEL_ENV !== 'production') {
    return {
      skip: true,
      reason: `VERCEL_ENV is "${env.VERCEL_ENV || 'unset'}" (migrations only run when VERCEL_ENV=production).`,
    };
  }

  if ((isVercel || isProd) && !env.DATABASE_URL?.trim()) {
    return {
      skip: true,
      reason: 'DATABASE_URL is missing.',
    };
  }

  return { skip: false };
}

function resolveDbConfig(preferDirectUrl = false): { mode: 'pg'; connectionString: string; strippedChannelBinding: boolean; key: string } | { mode: 'pglite'; dataDir: string; key: string } {
  const databaseUrl = preferDirectUrl
    ? resolveMigrationConnectionString()
    : process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    const normalized = normalizePostgresUrl(databaseUrl);
    return {
      mode: 'pg',
      connectionString: normalized.connectionString,
      strippedChannelBinding: normalized.strippedChannelBinding,
      key: `pg:${normalized.connectionString}`,
    };
  }
  if (isProductionRuntime()) {
    throw new DbConfigError(
      'DATABASE_URL environment variable is required in production (use your pooled Neon PostgreSQL string with ?sslmode=require).'
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

function mapDbError(err: unknown): Error {
  if (err instanceof DbConfigError || err instanceof DbUnreachableError || err instanceof DbMigrationsPendingError) {
    return err;
  }
  const pgErr = err as { code?: string; message?: string };
  const code = String(pgErr?.code || '');
  const msg = String(pgErr?.message || '');

  if (code === '42P01' || /relation\s+"?schema_migrations"?\s+does not exist/i.test(msg)) {
    return new DbMigrationsPendingError(
      'Database schema has not been migrated yet. Run `npm run db:migrate` before starting the app.'
    );
  }

  if (
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', '57P01', '57P03', '08001', '08006'].includes(code) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection terminated|timeout exceeded|could not connect|database is unreachable/i.test(msg)
  ) {
    return new DbUnreachableError(
      'Database is currently unreachable. Verify your pooled DATABASE_URL, SSL mode, and Neon compute status.'
    );
  }

  return err instanceof Error ? err : new Error(String(err));
}

async function createLocalPglite(dataDir: string): Promise<PGliteLike> {
  if (isProductionRuntime()) {
    throw new DbConfigError('PGlite is restricted to local development and cannot load in production.');
  }
  const pglitePkg = '@electric-sql/pglite';
  const mod = (await import(pglitePkg)) as { PGlite: new (dir: string) => PGliteLike };
  const instance = new mod.PGlite(dataDir);
  await instance.waitReady;
  return instance;
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
  try {
    if (_pool) {
      const res = await _pool.query(sql, params);
      return res.rows as T[];
    }
    if (_pglite) {
      const res = await _pglite.query<T>(sql, params);
      return res.rows;
    }
  } catch (err) {
    throw mapDbError(err);
  }
  throw new DbUnreachableError('Database connection is not initialized.');
}

async function rawQueryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await rawQuery<T>(sql, params);
  return rows[0] ?? null;
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

async function runWithRawTransaction<T>(fn: (tx: DbQueryRunner) => Promise<T>): Promise<T> {
  if (_pool) {
    let client: PoolClient;
    try {
      client = await _pool.connect();
    } catch (err) {
      throw mapDbError(err);
    }
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
      throw mapDbError(err);
    } finally {
      client.release();
    }
  }
  if (_pglite) {
    try {
      return await _pglite.transaction(async (tx) => fn(wrapPgRunner(tx as unknown as PoolClient)));
    } catch (err) {
      throw mapDbError(err);
    }
  }
  throw new DbUnreachableError('Database connection is not initialized.');
}

export async function withTransaction<T>(fn: (tx: DbQueryRunner) => Promise<T>): Promise<T> {
  await ensureDbReady();
  return runWithRawTransaction(fn);
}

async function openConnectionOnly(
  skipMemoryInit = false,
  preferDirectUrl = false
): Promise<{ mode: 'pg' | 'pglite'; dataDir?: string }> {
  const cfg = resolveDbConfig(preferDirectUrl);
  if (_initPromise && _activeTargetKey === cfg.key) {
    await _initPromise;
    return cfg.mode === 'pg' ? { mode: 'pg' } : { mode: 'pglite', dataDir: cfg.dataDir };
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
        max: Number(process.env.PG_POOL_MAX || 3),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 5000),
        connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
        statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000),
        query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 10000),
        allowExitOnIdle: true,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      });
      _pool.on('error', (err) => {
        console.error(JSON.stringify({ level: 'error', event: 'pg_pool_error', message: err.message }));
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
        _pglite = await createLocalPglite(cfg.dataDir);
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
          _pglite = await createLocalPglite(cfg.dataDir);
        } else {
          throw err;
        }
      }
    }

    if (!skipMemoryInit && cfg.mode === 'pglite' && cfg.dataDir === 'memory://') {
      await runMigrationsInternal();
      if (process.env.STRANGETHEORY_SKIP_SEED !== '1') {
        await runSeedInternal();
      }
      await bootstrapEnvAdminInternal();
    } else if (!skipMemoryInit && cfg.mode === 'pg') {
      await bootstrapEnvAdminIfTableReady();
    }
  })();

  try {
    await _initPromise;
    return cfg.mode === 'pg' ? { mode: 'pg' } : { mode: 'pglite', dataDir: cfg.dataDir };
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
    if (_pool) {
      try {
        await _pool.end();
      } catch {
        // ignore
      }
      _pool = null;
    }
    throw mapDbError(err);
  }
}

export async function ensureDbReady(): Promise<void> {
  await openConnectionOnly();
}

async function runMigrationsInternal(): Promise<{
  applied: Array<{ version: string; name: string }>;
  currentVersion: string | null;
}> {
  return runWithRawTransaction((tx) => applyVersionedMigrations(tx));
}

export async function runMigrations(): Promise<{
  applied: Array<{ version: string; name: string }>;
  currentVersion: string | null;
}> {
  await openConnectionOnly(true, true);
  return runMigrationsInternal();
}

export async function getSchemaStatus(): Promise<{
  version: string | null;
  name: string | null;
  appliedAt: string | null;
  migrationsCount: number;
}> {
  await ensureDbReady();
  try {
    const latest = await rawQueryOne<{ version: string; name: string; applied_at: string }>(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );
    const cnt = await rawQueryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM schema_migrations');
    return {
      version: latest?.version ?? null,
      name: latest?.name ?? null,
      appliedAt: latest?.applied_at ?? null,
      migrationsCount: Number(cnt?.c || 0),
    };
  } catch (err) {
    if (err instanceof DbMigrationsPendingError) {
      return { version: null, name: null, appliedAt: null, migrationsCount: 0 };
    }
    throw err;
  }
}

export async function checkDbHealth(): Promise<{
  ok: boolean;
  dbLatencyMs: number;
  schemaVersion: string | null;
  schemaName: string | null;
  migrationsCount: number;
}> {
  const start = performance.now();
  await ensureDbReady();
  await rawQueryOne('SELECT 1 AS ok');
  const dbLatencyMs = Math.round((performance.now() - start) * 100) / 100;
  const schema = await getSchemaStatus();
  return {
    ok: Boolean(schema.version),
    dbLatencyMs,
    schemaVersion: schema.version,
    schemaName: schema.name,
    migrationsCount: schema.migrationsCount,
  };
}

async function runSeedInternal(): Promise<{ insertedPosts: number; skippedPosts: number; totalSeedPosts: number }> {
  const seed = createSeedData();
  const authMap = new Map(seed.auth_users.map((u) => [u.id, u]));

  return runWithRawTransaction(async (runner) => {
    for (const cat of CATEGORIES) {
      await runner.executeSql(
        `INSERT INTO categories (id, name, slug, brain_region, color, description, position_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           slug = excluded.slug,
           brain_region = excluded.brain_region,
           color = excluded.color,
           description = excluded.description,
           position_json = excluded.position_json`,
        [cat.id, cat.name, cat.slug, cat.brain_region, cat.color, cat.description, JSON.stringify(cat.position)]
      );
    }

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

    const beforePostsRow = await runner.queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM posts WHERE is_seed = 1');
    const beforeCount = Number(beforePostsRow?.c || 0);

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

    const afterPostsRow = await runner.queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM posts WHERE is_seed = 1');
    const afterCount = Number(afterPostsRow?.c || 0);
    const insertedPosts = Math.max(0, afterCount - beforeCount);
    const skippedPosts = Math.max(0, seed.posts.length - insertedPosts);
    return { insertedPosts, skippedPosts, totalSeedPosts: seed.posts.length };
  });
}

export async function runSeed(): Promise<{ insertedPosts: number; skippedPosts: number; totalSeedPosts: number }> {
  await ensureDbReady();
  const schema = await getSchemaStatus();
  if (!schema.version) {
    throw new DbMigrationsPendingError('Database schema has not been migrated yet. Run `npm run db:migrate` first.');
  }
  const result = await runSeedInternal();
  await bootstrapEnvAdminInternal();
  return result;
}

async function bootstrapEnvAdminIfTableReady(): Promise<void> {
  if (!process.env.ADMIN_EMAIL?.trim() || !process.env.ADMIN_PASSWORD?.trim()) return;
  try {
    await bootstrapEnvAdminInternal();
  } catch (err) {
    if (err instanceof DbMigrationsPendingError) return;
    const code = String((err as { code?: string })?.code || '');
    if (code === '42P01') return;
    throw err;
  }
}

export async function bootstrapEnvAdminInternal(): Promise<boolean> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!email || !password) return false;

  const existingAdmin = await rawQuery<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existingAdmin.length > 0) return false;

  const username = (process.env.ADMIN_USERNAME?.trim() || 'admin')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 24);
  if (validatePasswordStrength(password, { email, username })) {
    console.warn('SECURITY WARNING: ADMIN_PASSWORD does not meet strength requirements (min 10 chars); bootstrap skipped.');
    return false;
  }

  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || 'Observatory Admin';
  const existingUsers = await rawQuery<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1',
    [email, username.toLowerCase()]
  );

  if (existingUsers[0]) {
    await rawQuery("UPDATE users SET role = 'admin', email_verified = 1 WHERE id = $1", [existingUsers[0].id]);
    return true;
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
  return true;
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
    await executeSql(
      `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
       VALUES ($1, $2, 'riddle_revealed', $3, $4, $5, NULL, 0, $6)
       ON CONFLICT (id) DO NOTHING`,
      [notifId, ans.user_id, 'Riddle solution revealed', post.title, `/riddle/${post.slug}`, nowIso]
    );
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

export async function recordCronRun(params: {
  jobName: 'daily' | 'weekly';
  status: 'ok' | 'error';
  summary?: Record<string, unknown>;
  errorMessage?: string;
  startedAtMs: number;
}): Promise<void> {
  const finishedMs = Date.now();
  const durationMs = Math.max(0, finishedMs - params.startedAtMs);
  const entry = {
    level: params.status === 'ok' ? 'info' : 'error',
    event: 'cron_run',
    jobName: params.jobName,
    status: params.status,
    durationMs,
    ...(params.summary ? { summary: params.summary } : {}),
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
    timestamp: new Date(finishedMs).toISOString(),
  };
  if (!process.env.NODE_TEST_CONTEXT) {
    console.log(JSON.stringify(entry));
  }
  try {
    await executeSql(
      `INSERT INTO cron_runs (id, job_name, status, summary_json, error_message, started_at, finished_at, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        `cron-${params.jobName}-${finishedMs}-${crypto.randomBytes(3).toString('hex')}`,
        params.jobName,
        params.status,
        JSON.stringify(params.summary || {}),
        (params.errorMessage || '').slice(0, 500),
        new Date(params.startedAtMs).toISOString(),
        new Date(finishedMs).toISOString(),
        durationMs,
      ]
    );
  } catch {
    // Do not mask primary cron error if cron_runs write fails
  }
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
    // Claim inside conditional update first for cross-instance idempotency
    const claimed = await queryOne<{ id: string }>(
      `UPDATE users SET last_weekly_digest_at = $1
       WHERE id = $2 AND (last_weekly_digest_at IS NULL OR last_weekly_digest_at <= $3)
       RETURNING id`,
      [nowIso, sub.id, sevenDaysAgoIso]
    );
    if (!claimed) continue;

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

    sentCount += 1;
  }

  return sentCount;
}

export async function runWeeklyMaintenance(originBaseUrl?: string): Promise<{
  weeklyChallengeWeekKey: string;
  weeklyEmailsSent: number;
}> {
  const startedAtMs = Date.now();
  try {
    await ensureDbReady();
    const challenge = await getOrCreateWeeklyChallenge();
    const weeklyEmailsSent = await runWeeklyDigestDispatch(originBaseUrl);
    const result = {
      weeklyChallengeWeekKey: challenge.weekKey,
      weeklyEmailsSent,
    };
    await recordCronRun({ jobName: 'weekly', status: 'ok', summary: result, startedAtMs });
    return result;
  } catch (err) {
    await recordCronRun({
      jobName: 'weekly',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      startedAtMs,
    });
    throw err;
  }
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
  const startedAtMs = Date.now();
  try {
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
        const inserted = await queryOne<{ id: string }>(
          `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, is_seed, created_at)
           VALUES ($1, $2, 'digest_post', 'Daily StrangeTheory Pick', $3, $4, NULL, 0, $5)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [notifId, sub.id, pickedExperimentTitle, href, nowIso]
        );
        if (inserted) {
          digestNotificationsSent += 1;
        }
      }
    }

    // 4. Prune stale rate_events older than 48h to keep table compact
    const rateCutoff = new Date(now.getTime() - 48 * 3600_000).toISOString();
    await executeSql('DELETE FROM rate_events WHERE created_at < $1', [rateCutoff]);

    // 5. Ensure weekly challenge snapshot & send Weekly Synapse email (max once per 7 days per subscriber)
    const weekly = await getOrCreateWeeklyChallenge(now);
    const weeklyEmailsSent = await runWeeklyDigestDispatch(originBaseUrl);

    const summary = {
      dayKey,
      autoRevealedCount: dueRiddles.length,
      experimentId,
      riddleId,
      digestNotificationsSent,
      weeklyChallengeWeekKey: weekly.weekKey,
      weeklyEmailsSent,
    };
    await recordCronRun({ jobName: 'daily', status: 'ok', summary, startedAtMs });
    return summary;
  } catch (err) {
    await recordCronRun({
      jobName: 'daily',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      startedAtMs,
    });
    throw err;
  }
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
