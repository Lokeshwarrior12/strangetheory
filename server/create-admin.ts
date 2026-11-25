import 'dotenv/config';
import { closeDb, ensureDbReady, queryOne, executeSql } from './db.js';
import { hashPassword } from './seed.js';
import { validatePasswordStrength } from '../src/lib/passwords.js';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

async function main() {
  const email = (parseArg('email') || process.env.ADMIN_EMAIL || '').toLowerCase();
  const username = (parseArg('username') || process.env.ADMIN_USERNAME || 'admin')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 24);
  const displayName = parseArg('name') || process.env.ADMIN_DISPLAY_NAME || 'Observatory Admin';
  const password = parseArg('password') || process.env.ADMIN_PASSWORD || '';

  if (!email || !email.includes('@')) {
    console.error('Error: Provide a valid email via --email=you@domain.com or ADMIN_EMAIL.');
    process.exit(1);
  }
  const pwIssue = validatePasswordStrength(password, { email, username });
  if (pwIssue) {
    console.error(`Error: ${pwIssue}`);
    process.exit(1);
  }

  await ensureDbReady();
  const existing = await queryOne<{ id: string; email: string; username: string; role: string }>(
    'SELECT id, email, username, role FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2',
    [email, username.toLowerCase()]
  );

  const { hash, salt } = hashPassword(password);

  if (existing) {
    await executeSql(
      "UPDATE users SET role = 'admin', email_verified = 1, banned = 0, password_hash = $1, salt = $2 WHERE id = $3",
      [hash, salt, existing.id]
    );
    console.log(`Promoted & updated existing user @${existing.username} (${existing.email}) to admin.`);
  } else {
    const userId = `user-admin-${Date.now()}`;
    await executeSql(
      `INSERT INTO users (
        id, email, username, display_name, avatar_url, bio, interests_json,
        synapse_total, role, badges_json, banned, email_verified, daily_digest_enabled,
        password_hash, salt, is_seed, created_at
      ) VALUES ($1, $2, $3, $4, '', 'StrangeTheory administrator.', '[]', 0, 'admin', '[]', 0, 1, 1, $5, $6, 0, $7)`,
      [userId, email, username, displayName, hash, salt, new Date().toISOString()]
    );
    console.log(`Created admin user @${username} (${email}).`);
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
