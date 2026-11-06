# Changelog

All notable changes to Library are documented here.

## [0.2.1] - 2026-11-06

### Fixed

- The packaged EPUB smoke harness opens its seeded fixture again: the Dashboard home route restored the `smoke_item_id` reader handoff that previously lived on the old library home route, so CI's launch validation no longer times out waiting for rendition diagnostics.

## [0.2.0] - 2026-11-06

### Added

- Automatic full-text indexing: scans now extract and index PDF and EPUB document contents into FTS5, reindexing is keyed to per-file content hashes, content-index status is exposed per item plus aggregate stats, and Library search surfaces "Inside indexed documents" passage matches with jump-to-item.
- A Metadata Review page (`/review`) listing pending Crossref, Open Library, and GROBID suggestions with source filters, confidence, and apply/dismiss, backed by a pending-suggestions API.
- Bulk catalog editing on All Library: multi-select across grid and table views, bulk metadata updates with undo, assigning an existing collection to all selected items, and a "select visible" shortcut.
- A Library Dashboard as the home route: catalog, reading, queue, and content-index summary cards, continue-reading progress, a queue preview, recently added items, and quick links.
- Collections improvements: editable name and description, manual item ordering backed by durable positions, and bulk-add to collections from the catalog. Schema v10 adds `collection_items.position`.
- Reader polish: durable PDF bookmarks (save, list, jump, remove), EPUB find-in-book across chapters with jump-to-result, and text-selection highlights/annotations persisted per item with a highlights panel. Schema v11 adds an `annotations` table.
- The app follows the desktop light/dark preference by default (`prefers-color-scheme`, reactive while open) with manual override retained.
- Settings became a page with horizontal tabs instead of an embedded dialog sidebar.
- The Diagnostics page presents runtime cards, startup timing, index metrics, and collapsible EPUB events instead of raw JSON.
- A native development mode: `deno task --cwd deno dev:desktop` starts Vite and the Deno Desktop shell with `--hmr`, proxying client assets through the local runtime for frontend hot reload.
- Library motion language across the shell: page cross-fades with rising entrances, a sliding sidebar highlight, a staggered first paint of the navigation, collapsible sidebar (⌘\), bottom-center toasts, and a capture-style command palette with a dimmed blurred layer, motion, and hint footer.
- Spring-animated progress bars on the Continue Reading cards and the item preview panel.
- An explicit Quit for the local app: a header power button and a Quit Library command in the palette.
- An item preview panel redesign: cover-and-actions sheet header, collapsible metadata and progress editing, session recency, toasts on queue and metadata actions.
- Collections: named sets of items backed by a `collections` / `collection_items` schema (v6) with full CRUD under `/api/collections[/:id[:/items]]`, cascade deletes, and case-insensitive unique names. The Collections page lists collections with item counts, creates them from an inline form, opens a detail view with an add-from-library search, per-item remove, and a two-step delete.
- A shadcn / Base UI–style pagination component on All Library: chevron previous/next, a rolling numbered window with ellipsoid gaps, and proper `aria-current` states.
- A switch-style Preview toggle on All Library (replaces the plain show/hide button) with correct `role="switch"` / `aria-checked` semantics.
- A configurable catalog page size: a books-per-page select (12–96, default 24) in Settings → Library, persisted via `catalog_page_size` in `app_settings` and served from `/api/settings`; All Library loads it before its first query.
- Loading skeletons across pages: animated card-shaped placeholders on All Library, Continue Reading, the reading queue, and Collections instead of text placeholders.

### Fixed

- The app now closes when its window is closed (Super+W, titlebar X): the Deno 2.9.8 runtime fixes the laufey 0.7.0 close deferral, and the app adopts its initial `BrowserWindow` and performs a graceful shutdown on the window `close` event.
- The boot redirect no longer stalls on "Opening Library…": a reactive write-after-read loop in the sidebar highlight froze the first navigation to the Continue Reading page.
- Header controls (search, theme, quit) share one uniform height and border treatment.
- Hiding the preview now gives the All Library grid the full page width instead of reserving an empty rail column.
- Stale schema-version assertions in the migration and HTTP bootstrap tests now match schema v11.
- The installed Linux desktop launcher resolves symlinks when locating the install root, so `~/.local/bin/library` opens the currently installed version instead of failing.

### Added

- Spring-animated progress bars on the Continue Reading cards and the item preview panel.

- All-caps research-paper titles are no longer rejected as corrupt metadata.
- Scanner tests no longer depend on files in one developer's home directory; the full Go suite now passes everywhere.
- Full-text search now treats punctuation-heavy titles as text instead of FTS query syntax.
- The desktop bundle now uses CEF because Linux WebKitGTK did not complete EPUB chapter iframe loads; the exact failing EPUB opens in about 330 ms in the packaged engine.
- Keyboard shortcuts no longer leak through readers or modal surfaces, and the shortcut reference matches implemented behavior.
- Svelte validation is clean with zero errors and zero warnings.
- Packaged EPUB failures now include per-method timing and iframe state diagnostics.

## [0.1.1] - 2026-09-26

### Fixed

- Added a review/apply metadata repair pass that only changes removable title noise and reliable EPUB-date or arXiv year fallbacks.
- Added standards-aware EPUB cover fallback selection for books whose package metadata does not declare a cover.
- Tightened arXiv filename matching so unrelated numeric filenames are not treated as paper years.

### Validation

- Applied 76 high-confidence metadata repairs across the local library database.
- Rebuilt and reinstalled the Linux desktop bundle from the Deno flow.

## [0.1.0] - 2026-09-26

### Added

- Fast in-app EPUB and PDF reading with durable progress, automatic sessions, and a bounded cancellable EPUB cache.
- EPUB cover extraction with standards-aware fallback selection and a generated title preview when an EPUB has no usable image.
- Lightweight PDF first-page previews with range requests and a 120% default reader zoom.
- Command palette with `Ctrl/Cmd+K`, compact filter chips, card-level Continue actions, and stronger keyboard focus behavior.
- Reading queue actions, drag-to-reorder, completion promotion, skip confirmation, and a curated ten-book/paper starter queue.
- IBM Plex Sans UI typography and IBM Plex Serif reading typography.
- Automated cache, cover-selection, scanner, database, and progress/session tests.
- Review-only metadata repair script at `deno/scripts/review-metadata.ts` for title and year suggestions with provenance.

### Fixed

- EPUB reader startup is resilient to cancellation and retains at most two warmed books.
- EPUB/PDF progress updates are throttled and finish state is persisted at the end of a document.
- ArXiv identifiers are no longer interpreted as literal years; modern ArXiv IDs can provide a year fallback.
- Metadata cleanup removes zero-width formatting noise and known EPUB conversion suffixes without overwriting manual edits.
- PDF reader opens at a sensible 120% zoom instead of 196%.

### Validation

- Deno checks and tests pass: 37 tests.
- Svelte check passes with no errors; production frontend build passes.
- Go scanner year/title tests and database tests pass.
- The full Go suite passes without the previously reported machine-local first-page fixture mismatch.
