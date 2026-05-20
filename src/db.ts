import { Database as BunDatabase } from "bun:sqlite"
import { mkdirSync } from "fs"
import { dirname } from "path"

export interface SessionRow {
  id: string
  title: string | null
  workspace: string
  projectPath: string
  createdAt: string
}

export interface MessageRow {
  id: string
  sessionId: string
  role: string
  content: string
  toolName: string | null
  createdAt: string
}

export interface Database {
  raw: BunDatabase
  upsertSession(session: SessionRow): void
  insertMessage(message: MessageRow): void
  hasSession(id: string): boolean
  hasMessage(id: string): boolean
  getLastIndexedTime(): string | null
  setLastIndexedTime(time: string): void
  close(): void
}

const SCHEMA_TABLES = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    workspace TEXT,
    project_path TEXT,
    created_at TEXT,
    updated_at TEXT,
    indexed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    created_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`

const SCHEMA_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    tool_name,
    content='messages',
    content_rowid='rowid'
  );
`

const SCHEMA_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, tool_name)
    VALUES (new.rowid, new.content, new.tool_name);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, tool_name)
    VALUES ('delete', old.rowid, old.content, old.tool_name);
  END;
`

export function createDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const raw = new BunDatabase(dbPath)
  raw.exec("PRAGMA journal_mode = WAL")
  raw.exec(SCHEMA_TABLES)
  raw.exec(SCHEMA_FTS)
  raw.exec(SCHEMA_TRIGGERS)

  const upsertSessionStmt = raw.prepare(`
    INSERT INTO sessions (id, title, workspace, project_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      updated_at = datetime('now')
  `)

  const insertMessageStmt = raw.prepare(`
    INSERT OR IGNORE INTO messages (id, session_id, role, content, tool_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const hasSessionStmt = raw.prepare("SELECT 1 FROM sessions WHERE id = ?")
  const hasMessageStmt = raw.prepare("SELECT 1 FROM messages WHERE id = ?")
  const getMetaStmt = raw.prepare("SELECT value FROM metadata WHERE key = ?")
  const setMetaStmt = raw.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")

  return {
    raw,
    upsertSession(session) {
      upsertSessionStmt.run(session.id, session.title, session.workspace, session.projectPath, session.createdAt)
    },
    insertMessage(message) {
      insertMessageStmt.run(message.id, message.sessionId, message.role, message.content.slice(0, 10240), message.toolName, message.createdAt)
    },
    hasSession(id) {
      return !!hasSessionStmt.get(id)
    },
    hasMessage(id) {
      return !!hasMessageStmt.get(id)
    },
    getLastIndexedTime() {
      const row = getMetaStmt.get("last_indexed_time") as { value: string } | undefined
      return row?.value ?? null
    },
    setLastIndexedTime(time) {
      setMetaStmt.run("last_indexed_time", time)
    },
    close() {
      raw.close()
    },
  }
}
