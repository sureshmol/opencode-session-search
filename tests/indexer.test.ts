import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createDatabase, type Database } from "../src/db"
import { indexMessage, indexSession, extractContent } from "../src/indexer"
import { unlinkSync, existsSync } from "fs"

const TEST_DB_PATH = "/tmp/opencode-session-search-test-indexer.db"

describe("Indexer", () => {
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

  test("extractContent from text part", () => {
    const content = extractContent([{ type: "text", text: "hello world" }])
    expect(content).toBe("hello world")
  })

  test("extractContent from tool-use part", () => {
    const content = extractContent([
      { type: "tool-use", toolName: "bash", args: { command: "ls -la" } },
    ])
    expect(content).toContain("bash")
    expect(content).toContain("ls -la")
  })

  test("extractContent from tool-result part", () => {
    const content = extractContent([
      { type: "tool-result", content: "file1.ts\nfile2.ts" },
    ])
    expect(content).toContain("file1.ts")
  })

  test("indexSession inserts session and messages", () => {
    const session = { id: "ses_1", title: "Test Session", createdAt: "2026-01-01" }
    const messages = [
      {
        info: { id: "msg_1", role: "user", createdAt: "2026-01-01" },
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        info: { id: "msg_2", role: "assistant", createdAt: "2026-01-01" },
        parts: [{ type: "text", text: "Hi there" }],
      },
    ]

    indexSession(db, session, messages, "/workspace")
    expect(db.hasSession("ses_1")).toBe(true)
    expect(db.hasMessage("msg_1")).toBe(true)
    expect(db.hasMessage("msg_2")).toBe(true)
  })

  test("indexMessage skips duplicates", () => {
    db.upsertSession({ id: "ses_1", title: "Test", workspace: "/tmp", projectPath: "/tmp", createdAt: "2026-01-01" })
    indexMessage(db, { id: "msg_1", sessionId: "ses_1", role: "user", content: "Hello", toolName: null, createdAt: "2026-01-01" })
    indexMessage(db, { id: "msg_1", sessionId: "ses_1", role: "user", content: "Hello", toolName: null, createdAt: "2026-01-01" })
    const count = db.raw.prepare("SELECT COUNT(*) as c FROM messages WHERE id = 'msg_1'").get() as any
    expect(count.c).toBe(1)
  })
})
