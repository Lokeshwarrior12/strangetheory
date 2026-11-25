import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbQueryRunner } from './db.js';

export interface MigrationRecord {
  version: string;
  name: string;
  sql: string;
}

function resolveMigrationsDir(): string {
  const cwdPath = path.resolve(process.cwd(), 'server', 'migrations');
  if (fs.existsSync(cwdPath)) return cwdPath;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const localPath = path.join(here, 'migrations');
  if (fs.existsSync(localPath)) return localPath;
  return path.resolve(here, '..', '..', 'server', 'migrations');
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && sql[i - 1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (ch === ';' && !inSingleQuote) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function loadMigrationFiles(): MigrationRecord[] {
  const dir = resolveMigrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));

  return files.map((filename) => {
    const match = filename.match(/^(\d+)_(.+)\.sql$/i);
    const version = match ? match[1] : filename;
    const name = match ? match[2] : filename;
    const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
    return { version, name, sql };
  });
}

export async function applyVersionedMigrations(runner: DbQueryRunner): Promise<{
  applied: Array<{ version: string; name: string }>;
  currentVersion: string | null;
}> {
  await runner.executeSql(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = await runner.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedSet = new Set(appliedRows.map((r) => String(r.version)));

  const migrations = loadMigrationFiles();
  const newlyApplied: Array<{ version: string; name: string }> = [];

  for (const mig of migrations) {
    if (appliedSet.has(mig.version)) continue;
    const statements = splitSqlStatements(mig.sql);
    for (const stmt of statements) {
      await runner.executeSql(stmt);
    }
    await runner.executeSql(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
      [mig.version, mig.name, new Date().toISOString()]
    );
    newlyApplied.push({ version: mig.version, name: mig.name });
  }

  const latest = await runner.queryOne<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
  );
  return {
    applied: newlyApplied,
    currentVersion: latest?.version ?? null,
  };
}
