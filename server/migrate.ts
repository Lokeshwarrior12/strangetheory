import 'dotenv/config';
import { closeDb, getDbEngineName, runMigrations, shouldSkipMigration } from './db.js';

async function main() {
  const skipCheck = shouldSkipMigration();
  if (skipCheck.skip) {
    console.log(`[db:migrate] Skipped: ${skipCheck.reason}`);
    return;
  }

  const hasDirectUrl = Boolean(process.env.DIRECT_URL?.trim());
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
  const engine = hasDirectUrl || hasDatabaseUrl ? 'postgres' : getDbEngineName();
  if (engine === 'postgres') {
    console.log(`[db:migrate] Target: ${hasDirectUrl ? 'DIRECT_URL' : 'DATABASE_URL'}`);
  }
  const result = await runMigrations();
  if (result.applied.length === 0) {
    console.log(`[db:migrate] ${engine} up to date (schema version ${result.currentVersion || 'none'}).`);
  } else {
    for (const mig of result.applied) {
      console.log(`[db:migrate] Applied ${mig.version}_${mig.name}`);
    }
    console.log(`[db:migrate] Completed (${engine} schema version ${result.currentVersion}).`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error('[db:migrate] Migration failed:', err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
