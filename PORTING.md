# Porting Plan: Go Backend → Deno/TypeScript + deno desktop

## Goal

Convert the Library app from a Go server + SvelteKit SPA into a cross-platform desktop app using `deno desktop`. The Go backend (~2,700 lines of business logic) gets rewritten in TypeScript. The SvelteKit frontend stays largely unchanged.

**End result:** Single binary, runs on macOS/Windows/Linux, no separate server process.

---

## Current Architecture

```
Go server (bin/server)
├── API handlers (handlers.go, reading.go)
├── SQLite database (db.go)
├── File scanner (scanner.go)
├── Readest sync (readest/)
└── Serves static files from web/static/

SvelteKit frontend (web/svelte/)
├── Svelte 5 + runes
├── Tailwind CSS v4
└── Builds to web/static/
```

## Target Architecture

```
deno desktop binary
├── Deno runtime (TypeScript backend)
│   ├── Hono HTTP framework
│   ├── @db/sqlite (native SQLite)
│   ├── File scanner (Deno.Command for pdfinfo/pdftotext)
│   └── Deno.serve() on random port
├── Webview (OS native or bundled CEF)
│   └── Loads http://127.0.0.1:<port>
└── SvelteKit frontend (embedded in binary)
```

---

## Learning Objectives

By the end of this port, you will have practiced:

1. **Deno runtime APIs** - `Deno.serve()`, `Deno.Command()`, `Deno.readDir()`, file system access
2. **SQLite in TypeScript** - Schema design, migrations, FTS5, triggers
3. **HTTP frameworks** - Hono routing, middleware, request/response handling
4. **TypeScript patterns** - Type narrowing, discriminated unions, error handling
5. **Code review** - Reading unfamiliar code, finding bugs, suggesting improvements
6. **Refactoring** - Extracting functions, eliminating duplication, naming
7. **Testing** - Unit tests with Deno's built-in test runner
8. **Desktop packaging** - `deno desktop` configuration, cross-compilation

---

## Phase 1: Project Scaffolding & Database Layer

**Who: Bernard (me) writes, you review**

### What I'll do:
- Create `deno.json` with `deno desktop` config, tasks, import maps
- Set up Hono HTTP server skeleton
- Port SQLite schema (5 tables + FTS5 + triggers)
- Create TypeScript type definitions (from `models.go`)
- Implement database connection with WAL mode + foreign keys

### What you'll do:
- Review my `deno.json` config - understand each field
- Review type definitions - compare with Go structs
- Ask questions about Deno APIs used

### Files created:
```
library/deno/
├── deno.json              # Config, tasks, desktop settings
├── src/
│   ├── main.ts            # Entry point (Deno.serve)
│   ├── db.ts              # SQLite connection + schema
│   └── types.ts           # All TypeScript interfaces
└── tests/
    └── db_test.ts         # Schema creation test
```

### Key concepts to discuss:
- `deno.json` `desktop` block vs CLI flags
- Why Hono over raw `Deno.serve()` (routing, middleware, type safety)
- SQLite WAL mode and busy timeout
- FTS5 with porter stemming for search

---

## Phase 2: Core API Endpoints

**Who: Split - Bernard writes search, you write CRUD**

### What I'll do:
- Implement `GET /api/search` (the most complex handler)
  - Dynamic WHERE clause building
  - FTS5 MATCH with `toFTSQuery()` (porter stemming, prefix search)
  - LIKE fallback for when FTS5 unavailable
  - Pagination with LIMIT/OFFSET
- Implement `POST /api/open` (spawns sioyek/readest/xdg-open)

### What you'll do (with my guidance):
- `GET /api/stats` - Aggregation query (COUNT by type/category/year)
- `GET /api/categories` - GROUP BY query with counts
- `GET /api/tags` - Join with `item_tags` junction table
- `GET /api/purposes` - GROUP BY with counts
- `GET /api/items/:id` - Simple SELECT by ID
- `PUT /api/items/:id` - Partial update (only non-null fields)
- `DELETE /api/items/:id` - DELETE with cascade

### You'll learn:
- How to build SQL queries in TypeScript
- Deno's URL routing patterns
- Error handling patterns (try/catch vs Result types)
- Type-safe query builders

### Review exercise:
After writing the CRUD endpoints, you'll review my search implementation:
1. Is the FTS5 query properly escaped?
2. Are there SQL injection risks?
3. Is pagination correct (total_pages calculation)?
4. Missing edge cases?

---

## Phase 3: File Scanner

**Who: Split - Bernard handles PDF, you handle EPUB + guessing**

### What I'll do:
- PDF metadata extraction using `Deno.Command("pdfinfo")`
- PDF first-page title extraction using `Deno.Command("pdftotext")`
- Title cleaning heuristics (strip Z-Library markers, bad metadata)
- `UpsertItem()` with `ON CONFLICT(path) DO UPDATE`

### What you'll do (with my guidance):
- EPUB metadata extraction (ZIP handling + XML parsing)
- Directory walking with `Deno.readDir()` recursive
- Category guessing rules (~30 keyword patterns)
- Tag guessing (~20 keywords)
- Purpose guessing from combined signals

### You'll learn:
- `Deno.Command()` for running external tools
- Async iteration (for reading directories)
- XML/JSON parsing in TypeScript
- Pattern matching with arrays of rules

### Refactoring exercise:
I'll give you a "before" version of the scanner with intentional issues:
- Duplicated logic between PDF and EPUB extraction
- Magic strings that should be constants
- Functions that do too many things (SRP violation)
- Deep nesting that should use early returns

You'll refactor it and we'll compare approaches.

---

## Phase 4: Reading API

**Who: Split - Bernard does dashboard, you do CRUD**

### What I'll do:
- `GET /api/reading/dashboard` (complex aggregation)
  - Currently reading items with session time
  - Queue with priority ordering
  - Total finished books
  - Today/week reading minutes

### What you'll do (with my guidance):
- `POST /api/reading/start/:id` - Create session + upsert progress
- `POST /api/reading/stop/:id` - Close session, calculate duration
- `POST /api/reading/progress/:id` - Upsert progress
- `GET /api/reading/sessions/:id` - Recent sessions
- Queue CRUD (add, remove, reorder)
- `POST /api/reading/finish/:id` - Mark finished + cleanup

### You'll learn:
- SQL JOINs for dashboard queries
- UPSERT patterns (`INSERT ... ON CONFLICT DO UPDATE`)
- Date math in SQLite (`julianday()`)
- Cascade deletes and their implications

---

## Phase 5: External Integrations

**Who: Bernard writes, you review and refactor**

### What I'll do:
- Readest sync (Flatpak data path, fuzzy title matching)
- FocusD sync (HTTP client to localhost:8082)
- File serving with correct MIME types
- Readest match algorithm (path → filename → fuzzy title)

### What you'll do:
- **Code review** my implementations using this checklist:
  1. Correctness - Does it match the Go behavior?
  2. Error handling - Are errors propagated, not swallowed?
  3. Type safety - No `any` types, proper narrowing?
  4. Performance - N+1 queries? Missing indexes?
  5. Readability - Would you understand this in 6 months?
- **Refactor** one section of my code for clarity

### You'll learn:
- Reading others' code systematically
- Identifying code smells
- HTTP client patterns in Deno
- Fuzzy string matching algorithms

---

## Phase 6: Deno Desktop & Polish

**Who: Together**

### What we'll do:
- Configure `deno desktop` in `deno.json`
- Set up auto-update with `Deno.autoUpdate()`
- Test cross-compilation (`--target`)
- Frontend API client adjustments (if needed)
- Final integration testing

### You'll learn:
- `deno desktop` configuration options
- WebView vs CEF tradeoffs
- Distribution formats (.app, .exe, .AppImage)
- Auto-update mechanism

---

## Code Review Checklist

Use this for every review session:

```markdown
## Review: [file/feature]

### Correctness
- [ ] Matches Go behavior?
- [ ] Edge cases handled? (null, empty, 0 items)
- [ ] SQL queries return expected results?

### Error Handling
- [ ] No swallowed errors (empty catch blocks)?
- [ ] Errors propagate to caller?
- [ ] User-facing errors are helpful?

### Type Safety
- [ ] No `any` types?
- [ ] Proper type narrowing after null checks?
- [ ] Function signatures match usage?

### Performance
- [ ] No N+1 query patterns?
- [ ] Pagination implemented correctly?
- [ ] Indexes used for WHERE/JOIN columns?

### Readability
- [ ] Functions do one thing?
- [ ] Variable names are clear?
- [ ] No magic numbers/strings?
```

---

## Refactoring Exercises

### Exercise 1: Extract Constants (Phase 3)
```typescript
// BEFORE - magic strings everywhere
if (ext === 'pdf' || ext === 'djvu') type = 'book';
if (ext === 'epub' || ext === 'mobi') type = 'ebook';
if (path.includes('thesis')) category = 'thesis';
// ... 30 more rules

// YOUR TASK: Extract to named constants and a rule engine
```

### Exercise 2: Eliminate Duplication (Phase 3)
```typescript
// BEFORE - duplicated extraction logic
async function extractPdfMetadata(path: string) {
  const info = await runCommand('pdfinfo', [path]);
  // parse info...
}
async function extractEpubMetadata(path: string) {
  const zip = await openZip(path);
  // parse zip...
}
// Both have: title cleaning, author normalization, year extraction

// YOUR TASK: Extract common pipeline, parameterize the source
```

### Exercise 3: Simplify Control Flow (Phase 4)
```typescript
// BEFORE - deep nesting
async function handleStartReading(id: number) {
  if (id) {
    const item = await db.getItem(id);
    if (item) {
      const existing = await db.getActiveSession(id);
      if (!existing) {
        // create session...
      } else {
        // error: already reading...
      }
    } else {
      // error: not found...
    }
  } else {
    // error: no id...
  }
}

// YOUR TASK: Use early returns, extract helpers
```

---

## Deno Dependencies

```json
{
  "imports": {
    "hono": "npm:hono@^4",
    "@hono/node-server": "npm:@hono/node-server@^1",
    "@db/sqlite": "npm:@db/sqlite@^0.12",
    "pdf-parse": "npm:pdf-parse@^1",
    "adm-zip": "npm:adm-zip@^0.5",
    "fast-xml-parser": "npm:fast-xml-parser@^4"
  }
}
```

| Dependency | Purpose | Replaces |
|------------|---------|----------|
| `hono` | HTTP framework | `net/http` |
| `@db/sqlite` | Native SQLite | `modernc.org/sqlite` |
| `pdf-parse` | PDF text extraction | `pdftotext` CLI |
| `adm-zip` | ZIP handling for EPUB | `unzip` CLI |
| `fast-xml-parser` | XML parsing for EPUB metadata | manual XML parsing |

---

## Database Schema (reference)

```sql
-- Core items table
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    authors TEXT DEFAULT '',
    year INTEGER DEFAULT 0,
    path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    category TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    purpose TEXT DEFAULT '',
    description TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE items_fts USING fts5(
    title, authors, filename, description,
    content=items, content_rowid=id,
    tokenize='porter unicode61'
);

-- Tags junction table
CREATE TABLE item_tags (
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (item_id, tag)
);

-- Reading progress
CREATE TABLE reading_progress (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'unread',
    progress_percent INTEGER DEFAULT 0,
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    started_at DATETIME,
    finished_at DATETIME,
    last_read_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Reading sessions
CREATE TABLE reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    started_at DATETIME NOT NULL,
    ended_at DATETIME,
    duration_seconds INTEGER DEFAULT 0,
    pages_read INTEGER DEFAULT 0
);

-- Reading queue
CREATE TABLE reading_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    focusd_book_number INTEGER,
    title TEXT NOT NULL,
    author TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints (reference)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/search` | `handleSearch` | Full-text search with filters, pagination |
| `GET` | `/api/items/:id` | `handleGetItem` | Get single item |
| `PUT` | `/api/items/:id` | `handleUpdateItem` | Update metadata |
| `DELETE` | `/api/items/:id` | `handleDeleteItem` | Delete item |
| `GET` | `/api/stats` | `handleStats` | Library statistics |
| `GET` | `/api/categories` | `handleCategories` | Categories with counts |
| `GET` | `/api/tags` | `handleTags` | Tags with counts |
| `GET` | `/api/purposes` | `handlePurposes` | Purposes with counts |
| `POST` | `/api/open/:id` | `handleOpen` | Open file externally |
| `GET` | `/api/file/:id` | `handleFile` | Serve file content |
| `POST` | `/api/scan` | `handleScan` | Trigger file scan |
| `GET` | `/api/reading/progress/:id` | `handleGetProgress` | Get reading progress |
| `POST` | `/api/reading/progress/:id` | `handleUpdateProgress` | Update progress |
| `POST` | `/api/reading/start/:id` | `handleStartReading` | Start session |
| `POST` | `/api/reading/stop/:id` | `handleStopReading` | Stop session |
| `GET` | `/api/reading/sessions/:id` | `handleGetSessions` | Get sessions |
| `GET` | `/api/reading/queue` | `handleGetQueue` | Get queue |
| `POST` | `/api/reading/queue` | `handleAddToQueue` | Add to queue |
| `DELETE` | `/api/reading/queue/:id` | `handleRemoveFromQueue` | Remove from queue |
| `POST` | `/api/reading/queue/reorder` | `handleReorderQueue` | Reorder queue |
| `GET` | `/api/reading/dashboard` | `handleDashboard` | Dashboard data |
| `POST` | `/api/reading/finish/:id` | `handleFinish` | Mark finished |
| `POST` | `/api/reading/sync-readest` | `handleSyncReadest` | Sync from Readest |
| `GET` | `/api/reading/readest-status` | `handleReadestStatus` | Readest sync status |
| `POST` | `/api/reading/sync-focusd` | `handleSyncFocusd` | Sync from FocusD |

---

## Progress Tracker

- [ ] Phase 1: Scaffolding & DB
- [ ] Phase 2: Core API
- [ ] Phase 3: Scanner
- [ ] Phase 4: Reading API
- [ ] Phase 5: Integrations
- [ ] Phase 6: Desktop & Polish

---

# Phase 1: Project Scaffolding & Database Layer (Detailed)

## Duration: ~1 hour
## Who: Bernard writes, you review

---

## Step 1.1: Project Structure

Create the Deno project alongside the existing Go code:

```
library/
├── deno/                        # NEW - Deno backend
│   ├── deno.json                # Config, tasks, desktop settings
│   ├── src/
│   │   ├── main.ts              # Entry point (Deno.serve + Hono)
│   │   ├── db.ts                # SQLite connection + schema migration
│   │   ├── types.ts             # All TypeScript interfaces
│   │   ├── router.ts            # Hono route definitions
│   │   └── handlers/
│   │       ├── search.ts        # (Phase 2)
│   │       ├── items.ts         # (Phase 2)
│   │       └── reading.ts       # (Phase 4)
│   └── tests/
│       └── db_test.ts           # Schema creation test
├── web/svelte/                  # Existing frontend (unchanged)
├── internal/                    # Existing Go code (kept for reference)
└── bin/                         # Existing Go binary
```

### Why this structure?
- `deno/` is self-contained - can be built independently
- `handlers/` directory mirrors the Go `api/` package
- Tests live next to source (Deno convention)
- `web/svelte/` stays untouched - the frontend API client already works

---

## Step 1.2: deno.json Configuration

```json
{
  "name": "library",
  "version": "1.0.0",
  "tasks": {
    "dev": "deno run -A --watch src/main.ts",
    "build": "deno run -A src/main.ts",
    "test": "deno test -A",
    "check": "deno check src/**/*.ts",
    "desktop": "deno desktop .",
    "desktop:dev": "deno desktop --hmr ."
  },
  "imports": {
    "hono": "npm:hono@^4",
    "@std/path": "jsr:@std/path@^1",
    "@std/media-types": "jsr:@std/media-types@^1"
  },
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false
  },
  "desktop": {
    "name": "Library",
    "identifier": "com.bernard.library",
    "backend": "webview",
    "macOS": {
      "icon": "./icons/icon.icns"
    },
    "windows": {
      "icon": "./icons/icon.ico"
    },
    "linux": {
      "icon": "./icons/icon.png"
    }
  }
}
```

### Key decisions:
- **`node:sqlite`** (built-in) over `@db/sqlite` (FFI) - no extra permissions needed
- **Hono** for routing - lightweight, Web Standard API, great Deno support
- **`-A` flag** for dev - SQLite needs file read/write, FFI for native tools
- **`backend: "webview"`** - small binary, uses OS webview

### Concepts to discuss:
- **`deno.json` `imports`** - Like `go.mod` require, maps bare specifiers to URLs
- **`compilerOptions`** - TypeScript strictness settings
- **`desktop` block** - Configuration for `deno desktop` compilation
- **`--watch` flag** - Hot reload during development

---

## Step 1.3: Type Definitions (types.ts)

Port all Go structs from `models.go` to TypeScript interfaces:

```typescript
// ── Core Types ──────────────────────────────────────────────

export type BookType = "book" | "paper" | "thesis" | "ebook" | "other";

export interface Item {
  id: number;
  title: string;
  authors: string;
  year: number;
  path: string;
  filename: string;
  type: BookType;
  category: string;
  tags: string;        // CSV (legacy, kept for compatibility)
  purpose: string;
  description: string;
  size: number;
  added_at: string;    // ISO datetime
  updated_at: string;
}

export interface ItemUpdate {
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  category?: string | null;
  tags?: string | null;
  purpose?: string | null;
  description?: string | null;
}

// ── Search ──────────────────────────────────────────────────

export interface SearchQuery {
  q: string;
  type: string;
  category: string;
  tag: string;
  purpose: string;
  year: number;
  sort: string;      // "" | "year" | "added" | "size"
  order: string;     // "" | "asc" | "desc"
  page: number;
  limit: number;
}

export interface SearchResult {
  items: Item[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// ── Statistics ──────────────────────────────────────────────

export interface Stats {
  total_items: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
  by_year: Record<string, number>;
  recent_added: Item[];
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface TagCount {
  name: string;
  count: number;
}

// ── Reading ─────────────────────────────────────────────────

export interface ReadingProgress {
  item_id: number;
  status: "unread" | "reading" | "finished" | "abandoned";
  progress_percent: number;
  current_page: number;
  total_pages: number;
  started_at: string | null;
  finished_at: string | null;
  last_read_at: string | null;
  updated_at: string;
}

export interface ReadingSession {
  id: number;
  item_id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  pages_read: number;
}

export interface ReadingQueueItem {
  id: number;
  item_id: number | null;
  focusd_book_number: number | null;
  title: string;
  author: string;
  priority: number;
  added_at: string;
  // Joined fields (from items table)
  file_path?: string | null;
  filename?: string | null;
  file_type?: string | null;
}

export interface ReadingDashboard {
  currently_reading: ReadingStatusItem[];
  queue: ReadingQueueItem[];
  total_read_books: number;
  total_reading_minutes: number;
  today_reading_minutes: number;
  week_reading_minutes: number;
}

export interface ReadingStatusItem {
  item: Item;
  progress: ReadingProgress;
  today_minutes: number;
  total_minutes: number;
}

// ── Readest Sync ────────────────────────────────────────────

export interface ReadestSyncStatus {
  enabled: boolean;
  last_sync_at: string | null;
  total_books: number;
  matched_books: number;
  unmatched_books: number;
  currently_reading: number;
}

export interface ReadestSyncResult {
  success: boolean;
  message: string;
  synced_at: string;
  total_books: number;
  matched_books: number;
  unmatched_books: number;
  updated_progress: number;
  books: ReadestSyncedBook[];
}

export interface ReadestSyncedBook {
  hash: string;
  title: string;
  library_item_id: number;
  current_page: number;
  total_pages: number;
  progress_percent: number;
  match_strategy: string;
  confidence: number;
}
```

### Review exercise:
Compare these TypeScript interfaces with the Go structs in `models.go`:
1. What's different about how TypeScript handles nullable fields vs Go pointers?
2. Why use `string | null` instead of `string | undefined`?
3. What does `Record<string, number>` replace in Go?

---

## Step 1.4: Database Layer (db.ts)

Port the schema migration and connection from Go's `db.go`:

```typescript
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "@std/path";
import { ensureDir } from "@std/fs";

const DB_DIR = join(Deno.env.get("HOME") ?? "~", ".local", "share", "library");
const DB_PATH = join(DB_DIR, "library.db");

export class DB {
  private conn: DatabaseSync;
  private ftsAvailable = false;

  constructor(dbPath: string = DB_PATH) {
    // Ensure directory exists
    ensureDirSync(dirname(dbPath));

    this.conn = new DatabaseSync(dbPath);

    // Set pragmas (matching Go behavior)
    this.conn.exec("PRAGMA journal_mode = WAL");
    this.conn.exec("PRAGMA busy_timeout = 5000");
    this.conn.exec("PRAGMA foreign_keys = ON");

    this.migrate();
  }

  private migrate(): void {
    // Core items table
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        authors TEXT DEFAULT '',
        year INTEGER DEFAULT 0,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        category TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        purpose TEXT DEFAULT '',
        description TEXT DEFAULT '',
        size INTEGER DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Indexes
    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)");
    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_category ON items(category)");
    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_year ON items(year)");
    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_title ON items(title)");

    // FTS5 (may fail if not compiled in)
    try {
      this.conn.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
          title, authors, filename, description,
          content='items',
          content_rowid='id',
          tokenize='porter unicode61'
        )
      `);
      this.ftsAvailable = true;
    } catch {
      console.warn("FTS5 not available, using LIKE fallback for search");
      this.ftsAvailable = false;
    }

    // FTS sync triggers (only if FTS available)
    if (this.ftsAvailable) {
      // ... triggers ...
    }

    // Tags junction table
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS item_tags (
        item_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (item_id, tag),
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      )
    `);

    // Reading tables
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS reading_progress (
        item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'unread',
        progress_percent INTEGER DEFAULT 0,
        current_page INTEGER DEFAULT 0,
        total_pages INTEGER DEFAULT 0,
        started_at DATETIME,
        finished_at DATETIME,
        last_read_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        started_at DATETIME NOT NULL,
        ended_at DATETIME,
        duration_seconds INTEGER DEFAULT 0,
        pages_read INTEGER DEFAULT 0
      )
    `);

    this.conn.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_item ON reading_sessions(item_id)
    `);

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS reading_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        focusd_book_number INTEGER,
        title TEXT NOT NULL,
        author TEXT DEFAULT '',
        priority INTEGER DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Expose for testing
  get connection(): DatabaseSync {
    return this.conn;
  }

  get hasFts(): boolean {
    return this.ftsAvailable;
  }

  close(): void {
    this.conn.close();
  }
}
```

### Concepts to discuss:
- **`DatabaseSync`** - Synchronous API (matches Go's `database/sql` behavior)
- **WAL mode** - Write-Ahead Logging for better concurrency
- **`foreign_keys = ON`** - Required for `ON DELETE CASCADE` to work
- **FTS5 graceful fallback** - If SQLite compiled without FTS5, use LIKE queries
- **`ensureDirSync`** - Like Go's `os.MkdirAll`

---

## Step 1.5: Entry Point (main.ts)

Minimal server to verify everything works:

```typescript
import { Hono } from "hono";
import { DB } from "./db.ts";

const app = new Hono();
const db = new DB();

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    fts: db.hasFts,
    version: "1.0.0",
  });
});

// Placeholder routes (implemented in Phase 2)
app.get("/api/search", (c) => c.json({ items: [], total: 0 }));
app.get("/api/stats", (c) => c.json({ total_items: 0 }));

// Start server
const port = parseInt(Deno.args[0] ?? "8080");
console.log(`Library server running on http://localhost:${port}`);

Deno.serve({ port }, app.fetch);
```

### Test it:
```bash
cd deno/
deno run -A src/main.ts 8080
# In another terminal:
curl http://localhost:8080/api/health
# → {"status":"ok","fts":true,"version":"1.0.0"}
```

---

## Step 1.6: Test (db_test.ts)

```typescript
import { assertEquals, assertExists } from "@std/assert";
import { DB } from "../src/db.ts";

Deno.test("schema creates all tables", () => {
  const db = new DB(":memory:");

  // Verify tables exist
  const tables = db.connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];

  const names = tables.map((t) => t.name);
  assertExists(names.includes("items"));
  assertExists(names.includes("item_tags"));
  assertExists(names.includes("reading_progress"));
  assertExists(names.includes("reading_sessions"));
  assertExists(names.includes("reading_queue"));

  db.close();
});

Deno.test("FTS5 is available", () => {
  const db = new DB(":memory:");
  assertEquals(db.hasFts, true);
  db.close();
});

Deno.test("foreign keys enforce cascade", () => {
  const db = new DB(":memory:");

  // Insert item
  db.connection
    .prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)")
    .run("Test Book", "/tmp/test.pdf", "test.pdf");

  // Insert tag
  db.connection
    .prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)")
    .run(1, "test");

  // Delete item should cascade to tags
  db.connection.prepare("DELETE FROM items WHERE id = ?").run(1);

  const tags = db.connection
    .prepare("SELECT COUNT(*) as count FROM item_tags")
    .value() as { count: number };

  assertEquals(tags.count, 0);

  db.close();
});
```

---

## Your Review Tasks

After I create these files, review them and answer:

1. **types.ts**: Compare with Go's `models.go`. What's the TypeScript equivalent of Go's pointer types (`*string`)? Why?

2. **db.ts**: 
   - Why do we set `foreign_keys = ON` explicitly?
   - What happens if we remove the `busy_timeout` pragma?
   - Why does FTS5 creation use try/catch instead of checking first?

3. **main.ts**:
   - What does `Deno.serve({ port }, app.fetch)` do?
   - Why is `app.fetch` passed as a function reference, not called?

4. **General**:
   - What permissions does `deno run -A` grant?
   - How does this compare to Go's implicit permissions?

---

## Checklist

- [ ] Create `deno/` directory structure
- [ ] Create `deno.json` with tasks and desktop config
- [ ] Create `src/types.ts` with all interfaces
- [ ] Create `src/db.ts` with schema migration
- [ ] Create `src/main.ts` with health endpoint
- [ ] Create `tests/db_test.ts` with basic tests
- [ ] Run `deno task test` - all pass
- [ ] Run `deno task dev` - server starts
- [ ] `curl localhost:8080/api/health` returns ok
- [ ] You've reviewed and understand each file
