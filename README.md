# Library

A personal knowledge base for tracking books, papers, and reading progress. Scans your local Documents, Downloads, and Books directories, indexes metadata, and gives you a web UI to browse and manage everything.

Integrates with [FocusD](https://github.com/nicholasgasior/focusd) to pull reading plans and sync completion status.

## Features

- **Auto-indexing** — scans local directories for PDFs, EPUBs, and other book formats, extracting title, author, tags, and categories
- **Reading tracking** — start/stop reading sessions, log pages read, track progress per book
- **FocusD sync** — pulls your reading queue from FocusD, marks tasks done when you finish a book
- **Search** — instant full-text search with filters by type, category, tag, and year
- **Keyboard-driven** — full keyboard navigation in the web UI (press `?` for shortcuts)
- **TUI mode** — terminal-based interface using [Bubble Tea](https://github.com/charmbracelet/bubbletea) for quick access without a browser

## Quick Start

```bash
# Build everything
make build

# Scan and index your library, then start the server
./bin/server --scan

# Or just start (uses existing database)
./bin/server
```

The web UI runs at [http://localhost:8080](http://localhost:8080).

### Dev mode

```bash
./dev.sh
```

Starts the SvelteKit dev server on port 5173 with hot reload.

## Building

Requires Go 1.25+ and Node.js.

```bash
make build          # build everything
make build-server   # Go server only
make build-tui      # terminal UI only
make build-web      # SvelteKit frontend only
```

## Commands

| Binary | Description |
|--------|-------------|
| `bin/server` | Web server + API |
| `bin/tui` | Terminal interface |
| `bin/organize` | File organization utility |

### Server flags

- `-port` — server port (default: `8080`)
- `-scan` — scan and index files before starting
- `-force` — re-parse all files during scan (use with `-scan`)

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/items` | List all items |
| `GET /api/items/:id` | Get item details |
| `GET /api/search?q=` | Search items |
| `GET /api/reading/progress` | All reading progress |
| `POST /api/reading/progress/:id` | Update reading progress |
| `GET /api/reading/queue` | Reading queue |
| `GET /api/reading/dashboard` | Aggregated stats |

## Project Structure

```
cmd/
  server/         # Web server entrypoint
  tui/            # Terminal UI
  organize/       # File organizer
internal/
  api/            # HTTP handlers
  db/             # SQLite database layer
  models/         # Data types
  scanner/        # File discovery and metadata extraction
  tui/            # Bubble Tea TUI components
  readest/        # Readest integration
web/
  svelte/         # SvelteKit frontend
  static/         # Legacy static assets
```

## Stack

- **Backend:** Go, SQLite ([modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite))
- **Frontend:** SvelteKit, Tailwind CSS, TypeScript
- **TUI:** [Bubble Tea](https://github.com/charmbracelet/bubbletea), [Lip Gloss](https://github.com/charmbracelet/lipgloss), [Bubbles](https://github.com/charmbracelet/bubbles)

## Data

The SQLite database lives at `~/.local/share/library/library.db`.

## License

MIT
