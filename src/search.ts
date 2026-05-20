import type { Database } from "./db"

export interface SearchOptions {
  query: string
  limit?: number
  workspace?: string
  dateFrom?: string
  dateTo?: string
}

export interface SearchResult {
  sessionId: string
  title: string | null
  workspace: string
  createdAt: string
  snippets: string[]
  relevanceScore: number
}

export function searchSessions(db: Database, options: SearchOptions): SearchResult[] {
  const { query, limit = 10, workspace, dateFrom, dateTo } = options

  const ftsQuery = query
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" OR ")

  if (!ftsQuery) return []

  let sql = `
    SELECT
      m.session_id,
      s.title,
      s.workspace,
      s.created_at,
      snippet(messages_fts, 0, '>>>', '<<<', '...', 40) as snippet,
      rank
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    JOIN sessions s ON s.id = m.session_id
    WHERE messages_fts MATCH ?
  `
  const params: any[] = [ftsQuery]

  if (workspace) {
    sql += " AND s.workspace = ?"
    params.push(workspace)
  }
  if (dateFrom) {
    sql += " AND s.created_at >= ?"
    params.push(dateFrom)
  }
  if (dateTo) {
    sql += " AND s.created_at <= ?"
    params.push(dateTo)
  }

  sql += " ORDER BY rank LIMIT ?"
  params.push(limit * 5)

  const rows = db.raw.prepare(sql).all(...params) as any[]

  const sessionMap = new Map<string, SearchResult>()

  for (const row of rows) {
    const existing = sessionMap.get(row.session_id)
    if (existing) {
      if (existing.snippets.length < 3) {
        existing.snippets.push(row.snippet)
      }
    } else {
      sessionMap.set(row.session_id, {
        sessionId: row.session_id,
        title: row.title,
        workspace: row.workspace,
        createdAt: row.created_at,
        snippets: [row.snippet],
        relevanceScore: Math.abs(row.rank),
      })
    }
  }

  return Array.from(sessionMap.values()).slice(0, limit)
}
