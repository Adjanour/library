# Reading lifecycle

Status: proposed design

This document defines the durable reading model independently of the EPUB or
PDF renderer. A renderer reports observations; the runtime owns transitions.

## States

```text
Unread ──queue──▶ Queued ──open──▶ Reading ──finish──▶ Finished
  ▲                 │                 │
  │                 └─remove──────────┘
  │                                   │
  └────────────── abandon/drop ◀──────┘
```

The durable status vocabulary is:

- `unread`: no active reading commitment;
- `queued`: intentionally selected for future reading;
- `reading`: measurable reading progress or an active reading commitment;
- `finished`: the item reached the completion boundary;
- `dropped`: the reader intentionally stopped pursuing it;
- `abandoned`: a separate recovery state for interrupted work, if product
  behavior requires distinguishing it from an intentional drop.

The implementation must decide whether `abandoned` is needed before adding more
UI. It should not be a vague synonym for every failed session.

## Ownership

The renderer owns its current in-memory position. The runtime owns:

- durable status;
- furthest progress;
- current resume location;
- active session records;
- bookmarks;
- queue membership;
- completion and promotion decisions.

The client may send measurements such as:

```text
item_id
location
progress_percent
current_page
total_pages
```

It must not send a command such as “set status to finished” as a substitute for
the runtime's transition rules.

## Core commands

### Queue item

Preconditions:

- the library item exists;
- it is not ignored;
- it is not already finished unless re-reading is explicitly supported.

Effects:

- create or restore queue membership;
- set status to `queued` when appropriate;
- preserve existing progress and resume location.

The operation should be idempotent for the same item.

### Start reading

Effects:

- create or reuse one active session for the item;
- transition `queued` to `reading`;
- do not create misleading durable progress at zero merely because a reader
  opened.

### Record progress

Effects:

- persist the latest valid resume location;
- preserve furthest progress;
- derive `reading` or `finished` from the measurement;
- update session activity only when the reader is active;
- never let a stale client move a finished item back to `reading`.

The current page/location may move backward while furthest percentage remains
unchanged. These are separate concepts.

### Heartbeat

Effects:

- refresh activity for the active session;
- never create a session by itself;
- return whether an active session still exists.

### Finish

Effects:

- atomically mark the item finished;
- close its active session;
- remove its queue entry;
- select the next eligible queue item;
- return the next item as a recommendation, not as an implicit second finish.

### Remove from queue

Effects:

- remove the queue membership;
- change `queued` to `unread` only when the item has no other reading state;
- preserve progress, bookmarks, and historical sessions.

### Drop or abandon

These must be separate commands if the product needs to distinguish user intent
from interrupted work. Both must preserve reading history unless deletion is an
explicitly different operation.

## Invariants

1. A library item has at most one durable reading-progress record.
2. A library item has at most one active reading session.
3. Queue membership and `queued` status cannot silently diverge.
4. Durable progress is never lowered by a stale client update.
5. A finished item cannot be reverted by an old progress request.
6. Resume location and furthest progress are independent fields.
7. Closing or crashing the client cannot leave a session active forever.
8. Finishing is atomic from the client's perspective.
9. Removing an item from the library does not accidentally erase reading history
   unless permanent deletion was explicitly requested.
10. EPUB and PDF are renderer formats, not separate reading domains.

## Failure scenarios to test

- the client crashes after opening but before its first progress write;
- two tabs report progress in opposite directions;
- a stale tab reports progress after another client finishes the book;
- the database is unavailable during a progress flush;
- the app closes while a progress request is in flight;
- a queued file disappears from disk;
- a book is re-added after its queue entry was removed;
- a finish request is retried;
- the next queued item is missing or ignored;
- localStorage contains a malformed or newer-than-database resume position.
