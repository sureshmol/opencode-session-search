import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createDatabase, type Database } from "../src/db"
import { searchSessions } from "../src/search"
import { unlinkSync, existsSync } from "fs"

const TEST_DB_PATH = "/tmp/opencode-session-search-test-search.db"

describe("Search", () => {
  let db: Database

  beforeEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(TEST_DB_PATH + suffix)) unlinkSync(TEST_DB_PATH + suffix)
    }
    db = createDatabase(TEST_DB_PATH)

    db.upsertSession({ id: "ses_1", title: "SSE filtering work", workspace: "/projects/api", projectPath: "/projects/api", createdAt: "2026-05-15" })
    db.upsertSession({ id: "ses_2", title: "React component", workspace: "/projects/web", projectPath: "/projects/web", createdAt: "2026-05-16" })

    db.insertMessage({ id: "msg_1", sessionId: "ses_1", role: "user", content: "Help me filter SSE events in the ai-agent-api", toolName: null, createdAt: "2026-05-15" })
    db.insertMessage({ id: "msg_2", sessionId: "ses_1", role: "assistant", content: "I'll modify the EventStream handler to accept a filter function", toolName: null, createdAt: "2026-05-15" })
    db.insertMessage({ id: "msg_3", sessionId: "ses_2", role: "user", content: "Create a button component with hover state", toolName: null, createdAt: "2026-05-16" })
  })

  afterEach(() => {
    db.close()
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(TEST_DB_PATH + suffix)) unlinkSync(TEST_DB_PATH + suffix)
    }
  })

  test("finds sessions by keyword", () => {
    const results = searchSessions(db, { query: "SSE" })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe("ses_1")
  })

  test("returns snippets with matches", () => {
    const results = searchSessions(db, { query: "filter" })
    expect(results[0].snippets.length).toBeGreaterThan(0)
    expect(results[0].snippets[0]).toContain("filter")
  })

  test("filters by workspace", () => {
    const results = searchSessions(db, { query: "component", workspace: "/projects/web" })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe("ses_2")
  })

  test("respects limit", () => {
    const results = searchSessions(db, { query: "SSE OR button", limit: 1 })
    expect(results.length).toBeLessThanOrEqual(1)
  })

  test("returns empty for no matches", () => {
    const results = searchSessions(db, { query: "kubernetes deployment" })
    expect(results).toHaveLength(0)
  })
})
