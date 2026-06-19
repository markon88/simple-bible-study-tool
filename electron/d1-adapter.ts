// A minimal D1Database-compatible wrapper around better-sqlite3, covering
// only the subset of the API the app's route handlers actually use
// (.prepare().bind().first()/.all()/.run()). D1 is SQLite under the hood,
// so the same migrations/*.sql files bootstrap this local database
// unmodified, and src/*.ts runs against this adapter with zero changes.
import Database from 'better-sqlite3';

class LocalPreparedStatement {
  constructor(private stmt: Database.Statement, private boundArgs: unknown[] = []) {}

  // Real D1's bind() returns a new, independently-bound statement rather
  // than mutating the original — that's what lets callers prepare once and
  // bind many times to build up a batch (see handleSignup's abbreviation
  // seeding). Mutating `this` here would make every entry in such a batch
  // silently collapse to the last-bound arguments.
  bind(...args: unknown[]): LocalPreparedStatement {
    return new LocalPreparedStatement(this.stmt, args);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.stmt.get(...this.boundArgs);
    return (row as T) ?? null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true }> {
    const rows = this.stmt.all(...this.boundArgs) as T[];
    return { results: rows, success: true };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const info = this.stmt.run(...this.boundArgs);
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }

  // Exposed so LocalD1.batch() can run each bound statement without a
  // round-trip per call (better-sqlite3 is synchronous/local anyway, but
  // wrapping in a transaction keeps the batch atomic, matching D1's
  // behavior).
  runSync(): void {
    this.stmt.run(...this.boundArgs);
  }
}

export class LocalD1 {
  constructor(private db: Database.Database) {}

  prepare(sql: string): LocalPreparedStatement {
    return new LocalPreparedStatement(this.db.prepare(sql));
  }

  async batch(statements: LocalPreparedStatement[]): Promise<{ success: true }[]> {
    const tx = this.db.transaction((stmts: LocalPreparedStatement[]) => {
      for (const stmt of stmts) stmt.runSync();
    });
    tx(statements);
    return statements.map(() => ({ success: true as const }));
  }
}

export function openLocalDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  const fs = require('node:fs');
  const path = require('node:path');
  db.exec(`CREATE TABLE IF NOT EXISTS applied_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const already = new Set(
    (db.prepare('SELECT name FROM applied_migrations').all() as { name: string }[]).map((r) => r.name)
  );
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (already.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Wrapped in a transaction so a mid-migration failure can't leave
    // partial DDL committed — matches D1's atomic-per-migration behavior
    // remotely, and means a failed migration can simply be retried.
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });
    applyMigration();
  }
}
