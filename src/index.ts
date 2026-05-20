import type { Plugin } from "@opencode-ai/plugin"
import { join } from "path"
import { homedir } from "os"
import { createDatabase } from "./db"
import { backfillSessions, indexMessage } from "./indexer"
import { createSearchTool, createOpenSessionTool, createListSessionsTool } from "./tool"
import { searchSessions } from "./search"

const DB_PATH = join(homedir(), ".local", "share", "opencode-session-search", "index.db")

export const SessionSearchPlugin: Plugin = async ({ client, directory }) => {
  const db = createDatabase(DB_PATH)

  // Background backfill on startup
  setTimeout(async () => {
    try {
      const count = await backfillSessions(db, client, directory)
      if (count > 0) {
        await client.app.log({
          body: {
            service: "opencode-session-search",
            level: "info",
            message: `Indexed ${count} existing sessions`,
          },
        })
      }
    } catch (err) {
      await client.app.log({
        body: {
          service: "opencode-session-search",
          level: "error",
          message: `Backfill failed: ${err}`,
        },
      })
    }
  }, 2000)

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const session = event.properties.info
        db.upsertSession({
          id: session.id,
          title: session.title ?? null,
          workspace: directory,
          projectPath: directory,
          createdAt: new Date(session.time.created).toISOString(),
        })
      }

      if (event.type === "message.part.updated") {
        const { part } = event.properties
        if (part.type !== "text") return
        if (!part.text?.trim()) return

        indexMessage(db, {
          id: part.id,
          sessionId: part.sessionID,
          role: "unknown",
          content: part.text,
          toolName: null,
          createdAt: new Date().toISOString(),
        })
      }
    },

    "command.execute.before": async ({ command, arguments: args }, output) => {
      if (command === "search-sessions" && args) {
        const results = searchSessions(db, { query: args })
        const formatted = results.length === 0
          ? "No matching sessions found."
          : results
              .map(
                (r, i) =>
                  `${i + 1}. ${r.title ?? "Untitled"} (${r.sessionId}) — ${r.workspace} — ${r.createdAt}\n   ${r.snippets[0] ?? ""}`
              )
              .join("\n")

        output.parts = [{
          type: "text",
          text: `[Session Search Results for "${args}"]\n${formatted}`,
        } as any]
      }

      if (command === "all-sessions") {
        const limit = args ? parseInt(args) || 25 : 25
        const rows = db.raw.prepare(`
          SELECT id, title, workspace, created_at
          FROM sessions
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit) as any[]

        const formatted = rows.length === 0
          ? "No sessions found."
          : rows
              .map(
                (r: any, i: number) =>
                  `${i + 1}. ${r.title || "Untitled"} (${r.id}) — ${r.workspace} — ${r.created_at}`
              )
              .join("\n")

        output.parts = [{
          type: "text",
          text: `[All Sessions (${rows.length} most recent)]\n${formatted}`,
        } as any]
      }
    },

    tool: {
      search_sessions: createSearchTool(db),
      list_all_sessions: createListSessionsTool(db),
      open_session: createOpenSessionTool(client),
    },
  }
}
