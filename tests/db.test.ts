import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createDatabase, type Database } from "../src/db"
import { unlinkSync, existsSync } from "fs"

const TEST_DB_PATH = "/tmp/opencode-session-search-test.db"

describe("Database", () => {
  let db: Database

  beforeEach(() => {
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + "-wal", TEST_DB_PATH + "-shm"]) {
      if (existsSync(f)) unlinkSync(f)
    }
    db = createDatabase(TEST_DB_PATH)
  })

  afterEach(() => {
    db.close()
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + "-wal", TEST_DB_PATH + "-shm"]) {
      if (existsSync(f)) unlinkSync(f)
    }
  })

  test("creates sessions table", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all()
    expect(tables).toHaveLength(1)
  })

  test("creates messages table", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
      .all()
    expect(tables).toHaveLength(1)
  })

  test("creates FTS virtual table", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .all()
    expect(tables).toHaveLength(1)
  })

  test("upsertSession inserts and updates", () => {
    db.upsertSession({ id: "ses_1", title: "Test", workspace: "/tmp", projectPath: "/tmp/proj", createdAt: "2026-01-01" })
    const row = db.raw.prepare("SELECT * FROM sessions WHERE id = ?").get("ses_1") as any
    expect(row.title).toBe("Test")

    db.upsertSession({ id: "ses_1", title: "Updated", workspace: "/tmp", projectPath: "/tmp/proj", createdAt: "2026-01-01" })
    const updated = db.raw.prepare("SELECT * FROM sessions WHERE id = ?").get("ses_1") as any
    expect(updated.title).toBe("Updated")
  })

  test("insertMessage adds to FTS index", () => {
    db.upsertSession({ id: "ses_1", title: "Test", workspace: "/tmp", projectPath: "/tmp/proj", createdAt: "2026-01-01" })
    db.insertMessage({ id: "msg_1", sessionId: "ses_1", role: "user", content: "SSE event filtering", toolName: null, createdAt: "2026-01-01" })

    const results = db.raw
      .prepare("SELECT * FROM messages_fts WHERE messages_fts MATCH ?")
      .all("SSE")
    expect(results.length).toBeGreaterThan(0)
  })
})
