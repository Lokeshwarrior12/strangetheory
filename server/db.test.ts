import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awardSynapse,
  closeDb,
  DbConfigError,
  enrichPost,
  ensureDbReady,
  executeSql,
  getPostById,
  getSchemaStatus,
  getUserById,
  purgeSeedData,
  query,
  queryOne,
  resolveMigrationConnectionString,
  runMigrations,
  runSeed,
  shouldSkipMigration,
} from './db.js';

async function setupMemoryDb(): Promise<void> {
  await closeDb();
  process.env.STRANGETHEORY_DB_MEMORY = '1';
  delete process.env.STRANGETHEORY_SKIP_SEED;
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  await ensureDbReady();
}

async function cleanupMemoryDb(): Promise<void> {
  await closeDb();
  delete process.env.STRANGETHEORY_DB_MEMORY;
}

function countWordsFromHtml(html: string): number {
  const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain ? plain.split(' ').length : 0;
}

test('Curated launch seed creates 20 unique entries (12 long-form experiments + 8 riddles) across all 10 brain regions with zero fake engagement', async () => {
  await setupMemoryDb();
  try {
    const expRows = await query<{ id: string; cover_url: string | null; body_json: string; intro: string; category_ids_json: string; ai_assisted: number }>(
      "SELECT id, cover_url, body_json, intro, category_ids_json, ai_assisted FROM posts WHERE type = 'experiment' AND status = 'published'"
    );
    const ridRows = await query<{ id: string; cover_url: string | null; category_ids_json: string; ai_assisted: number }>(
      "SELECT id, cover_url, category_ids_json, ai_assisted FROM posts WHERE type = 'riddle' AND status = 'published'"
    );
    const catCount = Number((await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM categories'))?.c || 0);
    const allPosts = [...expRows, ...ridRows];
    const uniqueCovers = new Set(allPosts.map((r) => r.cover_url).filter(Boolean));

    assert.equal(expRows.length, 12);
    assert.equal(ridRows.length, 8);
    assert.equal(catCount, 10);
    assert.equal(uniqueCovers.size, 20);

    // Every experiment is 600-1,000 words with no templated filler
    for (const exp of expRows) {
      const body = JSON.parse(exp.body_json) as { premise?: string; ripples?: string; breaks_down?: string; free_content?: string };
      const bodyOnly = `${body.premise || ''} ${body.ripples || ''} ${body.breaks_down || ''} ${body.free_content || ''}`;
      const text = `${exp.intro} ${bodyOnly}`;
      const bodyWords = countWordsFromHtml(bodyOnly);
      const words = countWordsFromHtml(text);
      assert.ok(bodyWords >= 600, `${exp.id} body should be >= 600 words (got ${bodyWords})`);
      assert.ok(words >= 600 && words <= 1000, `${exp.id} total should be 600-1000 words (got ${words})`);
      assert.equal(text.includes('Further readings connect'), false);
      assert.equal(exp.ai_assisted, 1);
    }

    // All 10 brain regions are represented
    const coveredCats = new Set<string>();
    for (const p of allPosts) {
      for (const cid of JSON.parse(p.category_ids_json) as string[]) {
        coveredCats.add(cid);
      }
    }
    assert.equal(coveredCats.size, 10);

    // Only StrangeTheory Editorial user exists with 0 Synapse and 0 fake engagement rows
    const users = await query<{ id: string; display_name: string; synapse_total: number }>('SELECT id, display_name, synapse_total FROM users');
    assert.equal(users.length, 1);
    assert.equal(users[0].display_name, 'StrangeTheory Editorial');
    assert.equal(users[0].synapse_total, 0);

    const commentsCount = Number((await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM comments'))?.c || 0);
    const reactionsCount = Number((await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM reactions'))?.c || 0);
    const followsCount = Number((await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM follows'))?.c || 0);
    assert.equal(commentsCount, 0);
    assert.equal(reactionsCount, 0);
    assert.equal(followsCount, 0);
  } finally {
    await cleanupMemoryDb();
  }
});

test('enrichPost strips riddle_secret and unrevealed hints for non-authors and exposes them to author', async () => {
  await setupMemoryDb();
  try {
    const riddlePost = (await getPostById('post-rid-1'))!;
    assert.ok(riddlePost);

    const forVisitor = await enrichPost(riddlePost, null);
    assert.equal(forVisitor.riddle_secret, null);
    assert.equal(forVisitor.riddle?.hints.length, 0);
    assert.equal(forVisitor.riddle_attempt?.answers_unlocked, false);

    const forOtherMember = await enrichPost(riddlePost, 'user-other');
    assert.equal(forOtherMember.riddle_secret, null);
    assert.equal(forOtherMember.riddle?.hints.length, 0);

    const forAuthor = await enrichPost(riddlePost, riddlePost.author_id);
    assert.ok(forAuthor.riddle_secret?.answer_text);
    assert.ok((forAuthor.riddle?.hints.length || 0) > 0);
    assert.equal(forAuthor.riddle_attempt?.answers_unlocked, true);
  } finally {
    await cleanupMemoryDb();
  }
});

test('awardSynapse updates points_ledger and synchronizes users.synapse_total', async () => {
  await setupMemoryDb();
  try {
    const now = new Date().toISOString();
    await executeSql(
      `INSERT INTO users (
        id, email, username, display_name, avatar_url, bio, interests_json,
        synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
        password_hash, salt, is_seed, created_at
      ) VALUES ($1, $2, $3, $4, '', '', '[]', 0, 'member', '[]', 0, 1, 1, 'h', 's', 0, $5)`,
      ['user-test-syn', 'syn@example.com', 'syn_tester', 'Syn Tester', now]
    );
    const before = (await getUserById('user-test-syn'))!.synapse_total;
    await awardSynapse('user-test-syn', 'Unit test award', 7, 'test-source');
    const after = (await getUserById('user-test-syn'))!.synapse_total;
    assert.equal(after, before + 7);
  } finally {
    await cleanupMemoryDb();
  }
});

test('purgeSeedData deletes launch seed records while preserving user-created posts', async () => {
  await setupMemoryDb();
  try {
    const now = new Date().toISOString();
    await executeSql(
      `INSERT INTO users (
        id, email, username, display_name, avatar_url, bio, interests_json,
        synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
        password_hash, salt, is_seed, created_at
      ) VALUES ($1, $2, $3, $4, '', '', '[]', 0, 'member', '[]', 0, 1, 1, 'h', 's', 0, $5)`,
      ['user-real-1', 'real@example.com', 'real_thinker', 'Real Thinker', now]
    );

    await executeSql(
      `INSERT INTO posts (
        id, author_id, type, title, slug, cover_url, intro, body_json,
        perspective, thinking_style, status, reading_minutes, ai_assisted, ai_disclosure,
        category_ids_json, forked_from_id, views, comments_count, insights_count, bookmarks_count,
        is_seed, published_at, created_at, updated_at
      ) VALUES ($1, $2, 'experiment', 'Real User Theory', 'real-user-theory', NULL, 'Intro', '{}',
        'Present', 'Speculative', 'published', 1, 0, NULL, '["cat-physics"]', NULL, 0, 0, 0, 0, 0, $3, $4, $5)`,
      ['post-real-1', 'user-real-1', now, now, now]
    );

    const result = await purgeSeedData();
    assert.equal(result.deletedPosts, 20);
    const remainingPosts = Number((await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM posts'))?.c || 0);
    const remainingUsers = Number((await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM users'))?.c || 0);
    assert.equal(remainingPosts, 1);
    assert.equal(remainingUsers, 1);
  } finally {
    await cleanupMemoryDb();
  }
});

test('Versioned migrations and idempotent seeding are safe to run twice', async () => {
  await closeDb();
  process.env.STRANGETHEORY_DB_MEMORY = '1';
  process.env.STRANGETHEORY_SKIP_SEED = '1';
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  try {
    const firstMigrate = await runMigrations();
    assert.deepEqual(
      firstMigrate.applied.map((m) => m.version),
      ['001', '002', '003', '004']
    );
    const secondMigrate = await runMigrations();
    assert.deepEqual(secondMigrate.applied, []);

    const schema = await getSchemaStatus();
    assert.equal(schema.version, '004');
    assert.equal(schema.migrationsCount, 4);

    delete process.env.STRANGETHEORY_SKIP_SEED;
    const firstSeed = await runSeed();
    assert.equal(firstSeed.insertedPosts, 20);
    assert.equal(firstSeed.skippedPosts, 0);

    const secondSeed = await runSeed();
    assert.equal(secondSeed.insertedPosts, 0);
    assert.equal(secondSeed.skippedPosts, 20);

    const postCount = Number((await queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM posts'))?.c || 0);
    assert.equal(postCount, 20);
  } finally {
    await cleanupMemoryDb();
  }
});

test('Production mode requires DATABASE_URL and throws DbConfigError', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevDbUrl = process.env.DATABASE_URL;
  await closeDb();
  process.env.NODE_ENV = 'production';
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      () => ensureDbReady(),
      (err: unknown) => err instanceof DbConfigError && /DATABASE_URL/.test(err.message)
    );
  } finally {
    await closeDb();
    process.env.NODE_ENV = prevEnv;
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
  }
});

test('Migration skip rules for non-production Vercel / missing DATABASE_URL and DIRECT_URL preference', () => {
  assert.equal(
    shouldSkipMigration({ VERCEL: '1', VERCEL_ENV: 'preview', DATABASE_URL: 'postgres://db' }).skip,
    true
  );
  assert.equal(
    shouldSkipMigration({ VERCEL: '1', VERCEL_ENV: 'development', DATABASE_URL: 'postgres://db' }).skip,
    true
  );
  assert.equal(
    shouldSkipMigration({ VERCEL: '1', VERCEL_ENV: 'production' }).skip,
    true
  );
  assert.equal(
    shouldSkipMigration({ NODE_ENV: 'production' }).skip,
    true
  );
  assert.equal(
    shouldSkipMigration({ VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'postgres://pooled' }).skip,
    false
  );
  assert.equal(
    shouldSkipMigration({ NODE_ENV: 'development' }).skip,
    false
  );

  assert.equal(
    resolveMigrationConnectionString({ DIRECT_URL: 'postgres://direct', DATABASE_URL: 'postgres://pooled' }),
    'postgres://direct'
  );
  assert.equal(
    resolveMigrationConnectionString({ DATABASE_URL: 'postgres://pooled' }),
    'postgres://pooled'
  );
  assert.equal(resolveMigrationConnectionString({}), null);
});
