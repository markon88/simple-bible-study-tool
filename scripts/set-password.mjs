// Sets or rotates a login account, and makes sure that user has their own
// personal copy of the default book abbreviations (existing customizations
// are left alone — this only fills in anything missing). There is no
// signup UI by design — account management is a local CLI step.
//
// Usage:
//   node scripts/set-password.mjs <username> <password> [--remote]
import { randomUUID, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAbbreviations } from './default-abbreviations.mjs';

const crypto = webcrypto;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

function runSqlFile(target, sql) {
  const file = join(tmpdir(), `sbst-${randomUUID()}.sql`);
  writeFileSync(file, sql);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'simple-bible-study-tool', target, '--file', file], {
      stdio: 'inherit',
    });
  } finally {
    unlinkSync(file);
  }
}

function runSqlJson(target, sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'simple-bible-study-tool', target, '--json', '--command', sql], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  return parsed[0].results;
}

const [username, password, flag] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: node scripts/set-password.mjs <username> <password> [--remote]');
  process.exit(1);
}

const target = flag === '--remote' ? '--remote' : '--local';
const hash = await hashPassword(password);
const id = randomUUID();
const now = new Date().toISOString();
const escapedUsername = username.replace(/'/g, "''");

console.error(`Applying to D1 (${target})...`);
runSqlFile(target, `INSERT INTO users (id, username, password_hash, created_at) VALUES ('${id}', '${escapedUsername}', '${hash}', '${now}') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;`);

const [{ id: userId }] = runSqlJson(target, `SELECT id FROM users WHERE username = '${escapedUsername}';`);

const seedLines = [];
for (const [book, abbrevs] of Object.entries(defaultAbbreviations)) {
  for (const abbrev of abbrevs) {
    seedLines.push(
      `INSERT OR IGNORE INTO book_abbreviations (id, user_id, book, abbrev) VALUES ('${randomUUID()}', '${userId}', '${book.replace(/'/g, "''")}', '${abbrev}');`
    );
  }
}
runSqlFile(target, seedLines.join('\n'));

console.error(`Done. Username "${username}" is ready to log in, with default book abbreviations seeded (existing customizations left untouched).`);
