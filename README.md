# Library

A local-first desktop library for books, papers, and reading progress. It indexes folders you choose, extracts metadata, and provides fast in-app EPUB and PDF readers.

Integrates with [FocusD](https://github.com/Adjanour/focusd) to pull reading plans and sync completion status.

## Features

- **Auto-indexing** — scans local directories for PDFs, EPUBs, and other book formats, extracting title, author, tags, and categories
- **Configurable folders** — add or remove watched folders from Settings; choices persist on the device
- **In-app reading** — EPUB and range-streamed PDF readers with durable progress and bookmarks
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

### Desktop app

The current desktop flow uses Deno Desktop and the Svelte production build:

```bash
cd web/svelte
pnpm install --frozen-lockfile
pnpm run build

cd ../../deno
deno task check
deno task test
deno task desktop
```

Linux is the currently verified release target. The runtime now uses platform-correct data paths and file launchers on macOS and Windows, and Deno Desktop can produce those targets, but signed/notarized installers still need CI builds and real-device verification before those platforms are advertised as supported.

Metadata extraction currently uses Poppler tools (`pdfinfo`, `pdftotext`) and `unzip` when available. Missing tools degrade to filename metadata rather than preventing the library or in-app readers from working.

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

The SQLite database follows each platform's application-data convention. Desktop builds use the CEF backend so EPUB rendering behaves consistently across Linux, macOS, and Windows; this trades a larger install for a predictable reading engine.

- Linux: `$XDG_DATA_HOME/library/library.db` or `~/.local/share/library/library.db`
- macOS: `~/Library/Application Support/library/library.db`
- Windows: `%LOCALAPPDATA%\library\library.db`

## License

MIT
