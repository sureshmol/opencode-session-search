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
  session: { id: string; title?: string | null; createdAt?: string },
  messages: { info: { id: string; role: string; createdAt?: string }; parts: any[] }[],
  workspace: string
): void {
  db.upsertSession({
    id: session.id,
    title: session.title ?? null,
    workspace,
    projectPath: workspace,
    createdAt: session.createdAt ?? new Date().toISOString(),
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
