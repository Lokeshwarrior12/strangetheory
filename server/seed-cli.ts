import 'dotenv/config';
import { closeDb, getDbEngineName, runSeed } from './db.js';

async function main() {
  if (process.env.STRANGETHEORY_SKIP_SEED === '1') {
    console.log('[db:seed] Skipped (STRANGETHEORY_SKIP_SEED=1).');
    return;
  }
  const engine = getDbEngineName();
  const result = await runSeed();
  console.log(
    `[db:seed] ${engine}: inserted ${result.insertedPosts} seed posts, skipped ${result.skippedPosts} existing (total curated catalog: ${result.totalSeedPosts}).`
  );
  await closeDb();
}

main().catch(async (err) => {
  console.error('[db:seed] Seeding failed:', err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
