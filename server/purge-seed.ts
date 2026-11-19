import 'dotenv/config';
import { closeDb, ensureDbReady, purgeSeedData } from './db';

async function main() {
  await ensureDbReady();
  const result = await purgeSeedData();
  await closeDb();
  console.log(`Cleared seed content: ${result.deletedPosts} posts and ${result.deletedUsers} sample user checks completed.`);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
