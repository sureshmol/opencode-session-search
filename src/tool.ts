import { tool } from "@opencode-ai/plugin"
import type { Database } from "./db"
import { searchSessions } from "./search"

export function createOpenSessionTool(client: any) {
  return tool({
    description:
      "Open/switch to a specific OpenCode session by its ID. Use this after search_sessions to navigate to a found session. Opens the session picker with the ID pre-filled.",
    args: {
      session_id: tool.schema.string().describe("The session ID to open (e.g. ses_1bf72c56dffeYs1SCP40tnL4zF)"),
    },
    async execute(args) {
      try {
        // Try switching via resume command
        await client.tui.executeCommand({ body: { command: `resume ${args.session_id}` } })
        return `Switched to session ${args.session_id}`
      } catch {
        try {
          // Fallback: open session picker and append ID to prompt
          await client.tui.openSessions({})
          return `Opened session picker. Look for session: ${args.session_id}`
        } catch (err) {
          return `Could not auto-switch. To open this session manually, use the session picker (ctrl+p) and search for: ${args.session_id}`
        }
      }
    },
  })
}

export function createSearchTool(db: Database) {
  return tool({
    description:
      "Search across all past OpenCode sessions by keyword, file path, or topic. Returns matching sessions with relevant text snippets. Use this to find previous conversations, locate session IDs for resumption, or recall past decisions.",
    args: {
      query: tool.schema.string().describe("Search query — keywords, file names, or topics"),
      limit: tool.schema.number().describe("Max results to return, default 10").optional(),
      workspace: tool.schema.string().describe("Filter by workspace/project path").optional(),
      date_from: tool.schema.string().describe("Filter sessions from this date (ISO format)").optional(),
      date_to: tool.schema.string().describe("Filter sessions up to this date (ISO format)").optional(),
    },
    async execute(args) {
      const results = searchSessions(db, {
        query: args.query,
        limit: args.limit,
        workspace: args.workspace,
        dateFrom: args.date_from,
        dateTo: args.date_to,
      })

      if (results.length === 0) {
        return "No matching sessions found."
      }

      return results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title ?? "Untitled"}** (${r.sessionId})\n` +
            `   Workspace: ${r.workspace}\n` +
            `   Date: ${r.createdAt}\n` +
            `   Snippets:\n${r.snippets.map((s) => `   - ${s}`).join("\n")}`
        )
        .join("\n\n")
    },
  })
}
