# Library + FocusD Integration & UI Rebuild Plan

## Overview

Upgrade library.local from a static book indexer into a **reading-aware knowledge base** that integrates with FocusD, tracks reading progress, and ships with a modern SvelteKit web UI.

---

## Phase 1: Backend (Schema + API)

### 1.1 Database Schema Additions

```sql
-- Reading progress per book
CREATE TABLE reading_progress (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'unread',        -- unread | reading | finished | abandoned
    progress_percent INTEGER DEFAULT 0,  -- 0-100
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    started_at DATETIME,
    finished_at DATETIME,
    last_read_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Reading sessions (time tracking)
CREATE TABLE reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    started_at DATETIME NOT NULL,
    ended_at DATETIME,
    duration_seconds INTEGER DEFAULT 0,
    pages_read INTEGER DEFAULT 0
);

-- Reading queue (synced from FocusD reading plan)
CREATE TABLE reading_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    focusd_book_number INTEGER,          -- links to FocusD reading plan book #
    title TEXT NOT NULL,                 -- fallback if item not in library yet
    author TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,          -- lower = higher priority
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 1.2 New API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/reading/progress` | All reading progress |
| `GET` | `/api/reading/progress/:id` | Progress for one book |
| `POST` | `/api/reading/progress/:id` | Update progress |
| `POST` | `/api/reading/start/:id` | Start reading (create session) |
| `POST` | `/api/reading/stop/:id` | Stop reading (close session) |
| `GET` | `/api/reading/sessions` | Recent reading sessions |
| `GET` | `/api/reading/sessions/:id` | Sessions for one book |
| `GET` | `/api/reading/queue` | Reading queue |
| `POST` | `/api/reading/queue` | Add to queue |
| `DELETE` | `/api/reading/queue/:id` | Remove from queue |
| `POST` | `/api/reading/queue/reorder` | Reorder queue |
| `GET` | `/api/reading/dashboard` | Aggregated reading stats |
| `POST` | `/api/reading/sync-focusd` | Pull FocusD reading plan into queue |
| `POST` | `/api/reading/finish/:id` | Mark as finished, notify FocusD |

### 1.3 FocusD Integration

**Sync FocusD → Library:**
- `POST /api/reading/sync-focusd` calls `GET http://localhost:8082/reading` on the FocusD daemon
- Parses the reading plan JSON (books with title, dates, focus area)
- Maps books to library items by title similarity
- Inserts unmatched books into `reading_queue` with `focusd_book_number`

**Library → FocusD:**
- When a book is marked "finished" via `POST /api/reading/finish/:id`, library POSTs to FocusD task API to mark the corresponding reading task as done
- `POST http://localhost:8082/tasks/done/:task_id`

### 1.4 Open in Readest

Update `handleOpen` to detect Readest:
```go
// Check if readest is installed
if _, err := exec.LookPath("readest"); err == nil {
    cmd = exec.Command("readest", item.Path)
} else {
    cmd = exec.Command("xdg-open", item.Path)
}
```

Or use the desktop file:
```go
cmd = exec.Command("xdg-open", item.Path)  // Readest registers as default for epub/pdf
```

---

## Phase 2: Web UI (SvelteKit)

### 2.1 Tech Stack

- **SvelteKit** with static adapter (served by Go)
- **Tailwind CSS** for styling
- **Skeleton** or **shadcn-svelte** for components
- **TypeScript** throughout

### 2.2 Layout: Split-Pane

```
┌─────────────────────────────────────────────────────┐
│  📚 Library    [Search: ___________]  [f]ilter [+]  │
├──────────────────┬──────────────────────────────────┤
│                  │                                   │
│  Book List       │   Book Details                   │
│  (instant filter)│                                   │
│                  │   Title: Attention Is All You Need│
│  ▸ Attention...  │   Authors: Vaswani et al.        │
│    Clean Code    │   Year: 2017                     │
│    Design Pat..  │   Type: paper                    │
│    Go Prog..     │   Category: machine-learning     │
│                  │   Tags: transformer, attention   │
│  ─────────────   │                                   │
│  Reading Queue   │   Progress: ████████░░ 78%       │
│  1. DDIA         │   Started: 2026-06-01            │
│  2. TAOCP        │   Time spent: 12h 30m            │
│                  │                                   │
│                  │   [Open in Readest] [Mark Done]  │
├──────────────────┴──────────────────────────────────┤
│  42 items  ·  page 1/3  ·  12h reading today        │
└─────────────────────────────────────────────────────┘
```

### 2.3 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate list |
| `Enter` | Open book details |
| `/` | Focus search |
| `Escape` | Close search / back to list |
| `f` | Open filter panel |
| `r` | Refresh |
| `o` or `Enter` in detail | Open in Readest |
| `d` | Mark as done |
| `q` | Toggle reading queue |
| `1-5` | Jump to category filters |
| `?` | Show keybinding help |

### 2.4 Dashboard View

When no book is selected, show:
- **Currently Reading** — book with progress bar, time today
- **Reading Queue** — next 5 books from FocusD plan
- **This Week** — hours read, books finished
- **Recent** — last 5 opened books
- **Stats** — total books, by type, by category

### 2.5 Instant Filtering

Type in search box → filters as you type (no submit button):
- Full-text search via FTS5
- Type filter: `type:paper`, `type:book`
- Category filter: `cat:machine-learning`
- Tag filter: `tag:textbook`
- Year filter: `year:2024`
- Status filter: `status:reading`, `status:unread`

### 2.6 Reading Progress UI

In book details panel:
```
Progress:  [████████░░] 78%
Pages:     312 / 400
Started:   June 1, 2026
Last read: 2 hours ago
Time spent: 12h 30m

[Start Reading]  [Update Progress]  [Mark Finished]
```

### 2.7 Reading Queue Panel

Left sidebar bottom section:
```
Reading Queue (from FocusD)
─────────────────────────
1. 📕 Designing Data-Intensive Applications
   2026-06-05 → 2026-06-19 · Systems Design
2. 📕 Structure and Interpretation
   2026-06-20 → 2026-07-04 · CS Fundamentals
3. 📄 Attention Is All You Need
   Unread · machine-learning
```

---

## Phase 3: Integration Flow

### Reading Workflow

1. User opens library web UI → sees dashboard with reading queue from FocusD
2. Clicks "Start Reading" on a book → creates reading session
3. Opens book in Readest → reads
4. Comes back → clicks "Stop Reading" → session logged
5. Updates progress (page/percent)
6. When progress reaches 100% or clicks "Mark Finished":
   - Library marks book as `finished`
   - Library POSTs to FocusD to mark the reading task as done
   - Book moves out of queue

### Data Flow

```
FocusD daemon (port 8082)
    │
    ├── GET /reading          ← library reads plan
    ├── POST /tasks/done/:id  ← library marks task done
    │
    └── Schedule/Mode data    ← for dashboard context

Library server (port 8080)
    │
    ├── /api/reading/*        ← reading progress/sessions/queue
    ├── /api/search           ← book search
    ├── /api/items/*          ← CRUD
    └── /web/static/*         ← SvelteKit app
```

---

## Implementation Order

1. **DB schema** — add tables, migration, indexes
2. **Reading CRUD** — progress, sessions, queue handlers
3. **FocusD sync** — pull plan, push completion
4. **Open in Readest** — update handleOpen
5. **SvelteKit scaffold** — project setup, Tailwind, layout
6. **Book list + search** — instant filtering, split pane
7. **Book details** — progress display, controls
8. **Dashboard** — stats, queue, currently reading
9. **Keyboard shortcuts** — keybindings throughout
10. **Reading workflow** — start/stop/update/finish flow

---

## Files to Create/Modify

### New Files
- `library/web/src/routes/+page.svelte` — main app
- `library/web/src/routes/+layout.svelte` — layout shell
- `library/web/src/lib/components/BookList.svelte`
- `library/web/src/lib/components/BookDetail.svelte`
- `library/web/src/lib/components/ReadingQueue.svelte`
- `library/web/src/lib/components/Dashboard.svelte`
- `library/web/src/lib/components/SearchBar.svelte`
- `library/web/src/lib/components/FilterPanel.svelte`
- `library/web/src/lib/components/ProgressBar.svelte`
- `library/web/src/lib/api.ts` — API client
- `library/web/src/lib/types.ts` — TypeScript types
- `library/web/tailwind.config.js`
- `library/web/svelte.config.js`

### Modified Files
- `library/internal/db/db.go` — new tables, migration, queries
- `library/internal/api/handlers.go` — new endpoints
- `library/internal/models/models.go` — new types
- `library/cmd/server/main.go` — serve SvelteKit build

---

## Completion Status

### Phase 1: Backend ✅
- [x] DB schema — `reading_progress`, `reading_sessions`, `reading_queue` tables
- [x] Migration from CSV tags to junction table
- [x] Reading CRUD — progress, sessions, queue handlers
- [x] FocusD sync — pull plan, push completion
- [x] Open in Readest — updated `handleOpen` with Readest detection
- [x] CORS headers on all API responses
- [x] DELETE endpoint for items
- [x] Content-Type header on file serving

### Phase 2: Web UI ✅
- [x] SvelteKit project with Tailwind CSS
- [x] Split-pane layout (420px left panel, flexible right)
- [x] Grid and list view modes
- [x] Search with instant filtering
- [x] Type, category, and sort filters
- [x] Pagination
- [x] Reading Dashboard view with stats
- [x] Currently reading section with progress bars
- [x] Reading queue synced from FocusD
- [x] Item detail panel with metadata

### Phase 3: Polish ✅
- [x] Reading progress: start/stop session from detail panel
- [x] Update progress (percent, page, total pages)
- [x] Mark finished button (notifies FocusD)
- [x] Open in Readest from detail panel
- [x] Search highlight terms
- [x] Delete confirmation modal (replaces browser `confirm()`)
- [x] Keyboard shortcuts modal (? to toggle)
- [x] All keyboard shortcuts: /, j/k, Enter, o, d, r, g, l, b, ?, Esc
- [x] Mobile responsive layout (back button, hidden panels)
- [x] Dev script with live reload (`./dev.sh`)

### What's Next
- [ ] Dev script with proper API proxying
- [ ] Mobile responsive polish (touch gestures)
- [ ] Error toasts/notifications
- [ ] Loading skeletons
- [ ] Recent books section in dashboard
- [ ] Tags click-to-filter
- [ ] Batch operations (multi-select delete)

---

## Estimated Effort

| Phase | Tasks | Est. Time |
|-------|-------|-----------|
| Phase 1: Backend | Schema + API + FocusD sync | 2-3 hours |
| Phase 2: Web UI | SvelteKit + components + styling | 3-4 hours |
| Phase 3: Polish | Keyboard shortcuts, transitions, error handling | 1-2 hours |
| **Total** | | **6-9 hours** |
