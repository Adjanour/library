# Reader redesign notes

Status: design addendum
Date: 2026-10-26
Audience: contributors working on reading state, readers, and desktop lifecycle

This document records the reader findings that constrain the Library redesign. It is an explanation of the current behavior and a reference for the implementation slices. It does not add new reader features to the `v0.1.1` preview.

## What is confirmed in the current code

### Progress writes are read-modify-write operations

Both `Reader.svelte` and `PdfReader.svelte` debounce progress for 500 ms, fetch the current progress row, merge the new page or percentage into that response, and post the result back.

This creates a race with finish operations. A stale GET can return before `finishReading` changes the row, and its later POST can restore the previous status. The server must own the status transition and accept only measurements from the client.

The atomic progress API now accepts:

- `current_page`
- `total_pages`
- `progress_percent`
- an optional reader location such as an EPUB CFI

It does not accept a client-selected status for ordinary progress updates. The server derives `unread`, `reading`, and `finished` from the measurement and preserves the furthest percentage while allowing the current page to move backwards.

This contract is implemented at `POST /api/reading/progress/:id`. The readers no longer fetch the existing row before writing progress.

### Opening and reading are currently mixed

`Reader.svelte` starts a session on mount. The database creates or reuses a session, but it does not create a reading-progress row until a non-zero progress update arrives. This means a newly opened book can have an active session while remaining unread, and the first visible progress may still be 0%.

The intended state model is:

| State | Meaning |
| --- | --- |
| No row | Never read or no durable activity yet |
| `reading` | Measurable activity exists and the item is not finished |
| `finished` | Explicitly finished or the finish rule has been met |
| `dropped` | Explicitly removed from active reading |

Opening a reader alone should not create a misleading reading state.

### Current-page progress is not furthest progress

Both readers derive progress from the current location. Going backwards therefore lowers the stored percentage. A reader can also reach the last PDF page while checking an appendix, which currently triggers `finishReading`.

The redesign should store both:

- the resume location, which may move backwards;
- the furthest measured location or percentage, which should not move backwards accidentally.

Finishing should require an explicit finish action or a deliberate rule based on sustained activity near the end. Merely viewing the last page should not silently remove a book from the queue.

### EPUB percentage needs location generation

`Reader.svelte` reads `location.percentage`, but `epubCache.ts` only opens and warms the book. It does not generate EPUB locations. The percentage can therefore remain zero for EPUBs where the underlying package has not generated locations.

EPUB opening should generate locations once per book, cache the result for the active reader, and persist the CFI as the authoritative resume location. The reader now sends the current CFI through the atomic progress endpoint, and the server persists it in `reading_progress.location`. Location generation and cold-open measurement remain separate performance work.

### Sessions can become stale

The original session model calculated duration from `started_at` to `ended_at`, with no visibility or idle detection. `/api/quit` also used to exit without closing active sessions, so an unclean exit could leave `ended_at` null and the next open could reuse that active session.

The session model now has an activity timestamp, a 30-second heartbeat while the reader is visible, startup cleanup for sessions idle beyond the stale threshold, and explicit shutdown cleanup through `/api/quit`. Heartbeats accumulate active seconds with a per-interval cap, while stale cleanup closes sessions without counting unattended wall-clock time. The reader also shows a paused state after five minutes without activity or while hidden.

### Positions and bookmarks were origin-local today

PDF pages, EPUB CFIs, and EPUB bookmarks were stored in `localStorage`. They are scoped to the browser origin, so the web preview, desktop preview, and different local ports did not share them. EPUB CFIs and bookmarks now have durable database storage; PDF page persistence remains the next format-neutral position slice.

The durable model now stores an optional resume location in `reading_progress`, and EPUB bookmarks live in the SQLite `bookmarks` table. Local storage remains a short-lived write-through cache for faster startup and compatibility with older data, but it is no longer the only source of truth.

### Diagnostics are too visible in production

EPUB reader failures currently include the internal `epub-trace-7` build marker, raw probe results, and trace milestones in the user-facing error string. The iframe probe is useful during diagnosis, but it should not be part of the normal production error path.

The reader should show a short recovery message and provide a `Copy diagnostics` action. Detailed traces should be retained behind a diagnostics flag and sent to the existing diagnostics endpoint only when enabled.

### Reader controls need format-specific scope

The EPUB reader owns font-size shortcuts. The PDF reader owns zoom shortcuts and persists the PDF zoom preference. These controls must not share a generic handler that changes EPUB preferences while a PDF is open.

The current PDF reader also uses pdf.js's private `_getVisiblePages()` hook. That is a maintenance risk and should be replaced with a supported event or a small compatibility adapter pinned to the pdf.js version used by the project.

### Range requests have a memory trade-off

The PDF reader requests 64 MiB ranges. The Deno range handler allocates a `Uint8Array` for the complete requested range before returning it. This is predictable, but it makes large concurrent range requests expensive. The next performance slice should measure first paint, peak resident memory, and request count before changing the chunk size or switching to a streaming range response.

## Proposed data model

The migration now provides a durable reader location and bookmark model. The reading state supports:

- `location` for an EPUB CFI or format-specific resume token;
- `current_page` and `total_pages` for paginated formats;
- `progress_percent` for display;
- monotonic `progress_percent` plus a movable current page/location;
- bookmarks owned by an item and identified by a stable location;
- server timestamps for last activity and finish state.

Progress updates should be atomic. A single request should update the measurement, derive status, update last activity, and return the resulting row. No client read-modify-write is required.

## Proposed status rules

- Opening a reader starts or resumes an activity session, but does not by itself create a reading row.
- The first meaningful progress measurement creates `reading` state.
- A backward seek changes the resume location but does not reduce furthest progress.
- A finish action is explicit, or the server applies a documented sustained-end rule.
- Dropping a book is explicit and durable.
- A session that has no heartbeat past the stale threshold is closed or marked orphaned during cleanup.

## Scope for the redesign

The reader redesign is a correctness and durability phase. It does not require EPUB search, PDF bookmarks, highlights, or a new reader visual system before `v0.1.1`. Those are follow-up features after progress, sessions, resume state, and diagnostics are reliable.

The redesign replaces the earlier non-goal of “readers unchanged” with:

> No new reader features in this phase. Existing EPUB and PDF reading behavior must become durable, race-free, diagnosable, and consistent across web and desktop surfaces.

## Acceptance tests

- A first open with no movement does not create a misleading 0% `reading` row.
- Two concurrent progress updates cannot restore `reading` after a finish transition.
- Moving backwards changes the resume location but never lowers furthest progress.
- Closing, crashing, or force-killing the app cannot leave a session active indefinitely.
- Restarting the web or desktop app restores the same EPUB CFI from SQLite; PDF page persistence remains a separate acceptance gate.
- EPUB percentage is non-zero after locations are generated and a relocation event occurs.
- User-facing EPUB failures do not expose raw traces; copied diagnostics still include enough detail to debug the engine.
- PDF memory and first-paint measurements are recorded for representative small and large documents.
