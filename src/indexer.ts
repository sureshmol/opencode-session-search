import type { Database, MessageRow } from "./db"

export function extractContent(parts: any[]): string {
  const chunks: string[] = []

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      chunks.push(part.text)
    } else if (part.type === "tool-use") {
      const argsStr = typeof part.args === "string" ? part.args : JSON.stringify(part.args ?? {})
      chunks.push(`[tool: ${part.toolName}] ${argsStr}`)
    } else if (part.type === "tool-result") {
      const resultStr = typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "")
      chunks.push(`[result] ${resultStr}`)
    }
  }

  return chunks.join("\n")
}

export function indexMessage(db: Database, message: MessageRow): void {
  if (db.hasMessage(message.id)) return
  db.insertMessage(message)
}

export function indexSession(
  db: Database,
  session: { id: string; title?: string | null; createdAt?: string; parentId?: string | null },
  messages: { info: { id: string; role: string; createdAt?: string }; parts: any[] }[],
  workspace: string
): void {
  db.upsertSession({
    id: session.id,
    title: session.title ?? null,
    workspace,
    projectPath: workspace,
    createdAt: session.createdAt ?? new Date().toISOString(),
    parentId: session.parentId ?? null,
  })

  for (const msg of messages) {
    const content = extractContent(msg.parts)
    if (!content.trim()) continue

    const toolName = msg.parts.find((p: any) => p.type === "tool-use")?.toolName ?? null

    indexMessage(db, {
      id: msg.info.id,
      sessionId: session.id,
      role: msg.info.role,
      content,
      toolName,
      createdAt: msg.info.createdAt ?? new Date().toISOString(),
    })
  }
}

export async function backfillSessions(
  db: Database,
  client: any,
  workspace: string
): Promise<number> {
  // Try direct DB access first (indexes ALL workspaces)
  const directCount = backfillFromOpencodeDb(db)
  if (directCount > 0) {
    db.setLastIndexedTime(new Date().toISOString())
    return directCount
  }

  // Fallback to SDK (only current workspace)
  const sessions = await client.session.list()
  let indexed = 0

  for (const session of sessions.data ?? sessions) {
    if (db.hasSession(session.id)) continue

    try {
      const messagesResp = await client.session.messages({ path: { id: session.id } })
      const messages = messagesResp.data ?? messagesResp
      indexSession(db, session, messages, workspace)
      indexed++
    } catch {
      // Session may be deleted or inaccessible, skip
    }
  }

  db.setLastIndexedTime(new Date().toISOString())
  return indexed
}

function backfillFromOpencodeDb(db: Database): number {
  const { Database: BunDb } = require("bun:sqlite") as any
  const { join } = require("path") as any
  const { homedir } = require("os") as any
  const { existsSync } = require("fs") as any

  const ocDbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")
  if (!existsSync(ocDbPath)) return 0

  let ocDb: any
  try {
    ocDb = new BunDb(ocDbPath, { readonly: true })
  } catch {
    return 0
  }

  let indexed = 0
  try {
    const sessions = ocDb.prepare(`
      SELECT id, title, directory, parent_id, time_created FROM session
      ORDER BY time_created DESC
    `).all() as any[]

    for (const session of sessions) {
      if (db.hasSession(session.id)) continue

      db.upsertSession({
        id: session.id,
        title: session.title ?? null,
        workspace: session.directory ?? "",
        projectPath: session.directory ?? "",
        createdAt: new Date(session.time_created).toISOString(),
        parentId: session.parent_id ?? null,
      })

      // Index text parts for this session
      const parts = ocDb.prepare(`
        SELECT p.id, p.session_id, p.data FROM part p
        WHERE p.session_id = ? AND p.data LIKE '{"type":"text"%'
        LIMIT 200
      `).all(session.id) as any[]

      for (const part of parts) {
        if (db.hasMessage(part.id)) continue
        try {
          const data = JSON.parse(part.data)
          if (data.type === "text" && data.text?.trim()) {
            db.insertMessage({
              id: part.id,
              sessionId: session.id,
              role: "unknown",
              content: data.text.slice(0, 10240),
              toolName: null,
              createdAt: new Date(session.time_created).toISOString(),
            })
            indexed++
          }
        } catch {
          // Skip malformed data
        }
      }

      // Also index tool parts for searchability
      const toolParts = ocDb.prepare(`
        SELECT p.id, p.session_id, p.data FROM part p
        WHERE p.session_id = ? AND p.data LIKE '{"type":"tool"%'
        LIMIT 100
      `).all(session.id) as any[]

      for (const part of toolParts) {
        if (db.hasMessage(part.id)) continue
        try {
          const data = JSON.parse(part.data)
          if (data.type === "tool" && data.tool) {
            const content = `[tool: ${data.tool}] ${JSON.stringify(data.state?.input ?? {}).slice(0, 5120)}`
            db.insertMessage({
              id: part.id,
              sessionId: session.id,
              role: "tool",
              content,
              toolName: data.tool,
              createdAt: new Date(session.time_created).toISOString(),
            })
            indexed++
          }
        } catch {
          // Skip malformed data
        }
      }
    }
  } finally {
    ocDb.close()
  }

  return indexed
}
