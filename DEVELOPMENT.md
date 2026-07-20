# Library - Development Guide

## Architecture

```
library/
├── cmd/server/main.go          # Go entrypoint, serves API + static files
├── internal/
│   ├── api/handlers.go         # HTTP handlers (search, open, CRUD)
│   ├── api/reading.go          # Reading progress/sessions/queue
│   ├── db/db.go                # SQLite layer
│   ├── models/models.go        # Data types
│   └── scanner/                # File indexing
├── web/svelte/src/
│   ├── routes/
│   │   ├── +layout.svelte      # Root layout (theme, global styles)
│   │   └── +page.svelte        # Main app (orchestrates everything)
│   ├── lib/
│   │   ├── api.ts              # API client + TypeScript types
│   │   ├── utils.ts            # Helpers (fileExt, formatSize, etc.)
│   │   └── components/         # Svelte components
│   └── app.css                 # Tailwind + theme variables
└── bin/server                  # Compiled Go binary
```

**Flow:** SvelteKit builds to `web/static/` → Go server serves those files + API on `:8080`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go, SQLite, `net/http` |
| Frontend | Svelte 5 (runes), SvelteKit |
| Styling | Tailwind CSS v4 |
| Build | Vite 8 |
| Types | TypeScript (strict) |
| Epub | epubjs |

---

## Svelte 5 Runes Patterns

This project uses **Svelte 5 with runes** (no legacy `$:` or `export let`).

### State

```svelte
<script lang="ts">
  // Simple reactive state
  let count = $state(0);
  let items = $state<Item[]>([]);

  // Object state
  let form = $state({ title: '', year: 0 });
</script>
```

### Props

```svelte
<script lang="ts">
  // Destructured props with types
  let { item, onClick, onSaved }: {
    item: Item;
    onClick: (item: Item) => void;
    onSaved: (updated: Item) => void;
  } = $props();
</script>
```

### Derived

```svelte
<script lang="ts">
  // Computed value (recalculates when deps change)
  const ext = $derived(item ? fileExt(item.filename) : '');
  const previewUrl = $derived(item ? `/api/file/${item.id}` : '');
</script>
```

### Effects

```svelte
<script lang="ts">
  // Runs when dependencies change (like componentDidUpdate)
  $effect(() => {
    if (item) { infoCollapsed = true; }
  });

  // Cleanup pattern (like useEffect return)
  $effect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchData();
      if (!cancelled) result = data;
    })();
    return () => { cancelled = true; };
  });
</script>
```

### Two-way Binding

```svelte
<select bind:value={sortBy} onchange={() => { page = 1; search(); }}>
  <option value="">Sort: Title</option>
</select>

<input bind:value={form.title} />
```

### Conditional Classes

```svelte
<button class:bg-accent={isActive} class:text-white={isActive}>
```

---

## Component Patterns

### Component Structure

Every component follows this order:
1. `<script lang="ts">` - imports, props, state, effects, functions
2. HTML template with `{#if}` / `{#each}` blocks
3. `<style>` if needed (rare - mostly Tailwind)

### Naming Conventions

- **Components:** PascalCase `DetailPanel.svelte`, `BookCard.svelte`
- **Props:** camelCase `selectedItem`, `showPreviewPanel`
- **Events:** `on` prefix `onOpen`, `onDelete`, `onSaved`
- **State:** descriptive `infoCollapsed`, `isResizing`
- **Files:** `api.ts`, `utils.ts` (no `.service.ts` etc.)

### Props Interface Pattern

Always type props inline (no separate interface):

```svelte
<script lang="ts">
  let { item, onOpen }: {
    item: Item;
    onOpen: (item: Item) => void;
  } = $props();
</script>
```

### Callback Pattern

Events bubble up via callback props (no Svelte events/dispatch):

```svelte
<!-- Parent -->
<DetailPanel onOpen={(item) => api.open(item.id)} />

<!-- Child -->
<button onclick={() => onOpen(item)}>Open</button>
```

---

## API Patterns

### Client (`src/lib/api.ts`)

```typescript
// All API calls go through get/post/put/del helpers
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Export as namespace
export const api = {
  search: (q: string, opts?: SearchOpts) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    // ...
    return get<SearchResult>('/api/search?' + params);
  },
  open: (id: number) => post(`/api/open/${id}`),
};
```

### Backend Routes (`internal/api/handlers.go`)

```go
// Pattern: parse ID from URL path
func (h *Handler) handleOpen(w http.ResponseWriter, r *http.Request) {
    idStr := r.URL.Path[len("/api/open/"):]
    id, err := strconv.ParseInt(idStr, 10, 64)
    // ...
    item, err := h.db.GetItem(id)
    // ...
    writeJSON(w, map[string]string{"status": "opened"})
}
```

---

## Layout Pattern

The app uses a three-column flex layout:

```
┌──────────┬────────────────┬─────────────────────────┐
│ Sidebar  │  Middle List   │  Right Panel (optional) │
│ (224px)  │  (resizable)   │  (resizable)            │
│ fixed    │  flex/variable │  flex-1 / hidden        │
└──────────┴────────────────┴─────────────────────────┘
```

- **Sidebar:** Hidden on mobile, fixed width
- **Middle:** Expands when preview off, resizable when preview on
- **Right:** Toggleable via `showPreviewPanel`, resizable via drag handle

---

## Styling Conventions

### Theme Variables

```css
/* Used via Tailwind utilities */
bg-surface-0    /* Main background */
bg-surface-1    /* Cards, panels */
bg-surface-2    /* Inputs, subtle bg */
bg-surface-3    /* Borders, hover states */
text-text-primary
text-text-secondary
text-text-muted
border-border
text-accent / bg-accent    /* Primary action color */
```

### Common Patterns

```svelte
<!-- Interactive elements -->
<button class="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors">

<!-- Subtle elements -->
<button class="px-2 py-0.5 rounded hover:bg-surface-3 transition-colors">

<!-- Badges -->
<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">
```

### Typography

- `text-xs` (12px) - metadata, labels
- `text-sm` (14px) - body text, buttons
- `text-base` (16px) - headings
- `text-[10px]` - very small labels, badges

---

## Keyboard Shortcuts

Implemented in `+page.svelte` `handleKeydown`:

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `j` / `k` | Navigate list |
| `Enter` / `o` | Open in external app |
| `r` | Read in-app |
| `e` | Edit metadata |
| `d` | Delete item |
| `p` | Toggle preview panel |
| `g` / `l` | Grid / List view |
| `b` | Reading dashboard |
| `R` | Rescan library |
| `?` | Show shortcuts |
| `Esc` | Close / deselect |

---

## State Management

All state lives in `+page.svelte` (no stores):

```svelte
<script lang="ts">
  // Data
  let items = $state<Item[]>([]);
  let selectedItem = $state<Item | null>(null);

  // UI state (persisted)
  let theme = $state<'dark' | 'light'>(
    localStorage.getItem('theme') as 'dark' | 'light' || 'dark'
  );
  let showPreviewPanel = $state(
    localStorage.getItem('showPreviewPanel') !== 'false'
  );
  let itemsPerPage = $state(
    parseInt(localStorage.getItem('itemsPerPage') || '20', 10)
  );

  // Persistence pattern
  function togglePreviewPanel() {
    showPreviewPanel = !showPreviewPanel;
    localStorage.setItem('showPreviewPanel', String(showPreviewPanel));
  }
</script>
```

---

## Build & Dev

```bash
cd web/svelte

npm run dev          # Vite dev server with HMR
npm run build        # Build to ../static/
npm run check        # Type checking

# After building, restart the systemd service:
systemctl --user restart library
```

**Important:** The Go server serves static files from `web/static/`. After `npm run build`, you must restart the service for changes to take effect.

---

## File Naming

```
components/
├── DetailPanel.svelte    # PascalCase for components
├── BookCard.svelte
├── MetadataEditor.svelte
├── Toolbar.svelte        # Single word is fine
└── Modals.svelte

lib/
├── api.ts                # camelCase for modules
├── utils.ts
```

---

## Common Pitfalls

1. **Forgetting to restart the service** after building - static files are served from disk, not cached
2. **Using `$:` instead of `$effect`/`$derived`** - this is Svelte 5, use runes
3. **Exporting props** - use `let { prop } = $props()` pattern
4. **Missing cleanup in effects** - return a cleanup function for async work
5. **Not persisting UI state** - save toggles/dimensions to localStorage
