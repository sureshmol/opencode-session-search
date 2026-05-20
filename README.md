# opencode-session-search

Search across all your OpenCode sessions with full-text search. Find past conversations by keyword, file path, or topic — across all workspaces.

## Install

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-session-search"]
}
```

## Features

- **Full-text search** across all session messages (user, assistant, tool calls)
- **Cross-workspace** — single index covers all your projects
- **Retroactive indexing** — indexes existing sessions on first run
- **Real-time indexing** — new messages indexed as they happen
- **Custom tool** — AI agent can search past sessions via `search_sessions`
- **Slash command** — `/search-sessions <query>` from the TUI

## Usage

### Via AI Tool

The plugin adds a `search_sessions` tool that the AI can use:

> "Search my past sessions for SSE event filtering"

### Via Command

```
/search-sessions SSE event filtering
```

## Search Options

| Option | Description |
|--------|-------------|
| `query` | Keywords to search for (required) |
| `limit` | Max results (default: 10) |
| `workspace` | Filter by project path |
| `date_from` | ISO date — only sessions after this date |
| `date_to` | ISO date — only sessions before this date |

## Storage

The search index is stored at:
```
~/.local/share/opencode-session-search/index.db
```

This is a SQLite database with FTS5 full-text search. You can query it directly if needed.

## License

MIT
