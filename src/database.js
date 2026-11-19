import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path = process.env.DATABASE_PATH || 'helpdesk.sqlite') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','agent','admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY, subject TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      assignee_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS tickets_customer ON tickets(customer_id);
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id),
      ticket_id INTEGER REFERENCES tickets(id), action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  const columns=new Set(db.prepare('PRAGMA table_info(tickets)').all().map(c=>c.name));
  db.exec('BEGIN');
  try {
    if(!columns.has('first_response_at')) {
      db.exec('ALTER TABLE tickets ADD COLUMN first_response_at TEXT');
      db.exec(`UPDATE tickets SET first_response_at=(SELECT min(c.created_at) FROM comments c JOIN users u ON u.id=c.author_id WHERE c.ticket_id=tickets.id AND u.role IN ('agent','admin'))`);
    }
    if(!columns.has('resolved_at')) {
      db.exec('ALTER TABLE tickets ADD COLUMN resolved_at TEXT');
      db.exec(`UPDATE tickets SET resolved_at=updated_at WHERE status IN ('resolved','closed')`);
    }
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');db.close();throw error;}
  return db;
}
