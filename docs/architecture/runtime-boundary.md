# Runtime boundary and transport

Status: proposed design

## Decision direction

Library should keep HTTP as its primary client/runtime boundary for the current
architecture. It gives the browser preview and desktop app the same behavior,
makes the boundary inspectable, and keeps API-level tests straightforward.

Deno Desktop bindings should be introduced only for native capabilities or for a
measured high-frequency path where HTTP is a demonstrated bottleneck. We should
not maintain two parallel application APIs without a concrete need.

## What the current system is

```text
Svelte client
  ── fetch('/api/...') ──▶ Deno.serve()
                              ├─ application routes
                              ├─ SQLite
                              ├─ filesystem
                              └─ subprocesses
```

In desktop mode, Deno Desktop selects an unused loopback port and points the
embedded CEF window at it. In browser-preview mode, the same client talks to a
normal Deno server. The transport is local HTTP in both cases.

## Terminology

The API should be described as a local application API rather than simply as
REST. It contains two kinds of operations:

- resource queries and representations, such as `GET /api/items/:id`;
- named application commands, such as `POST /api/reading/finish/:id`.

That distinction is intentional. Commands are allowed where a state transition
has domain meaning, but each command must define its input, output, idempotency,
transaction boundary, and failure behavior.

## Ownership rules

The client owns:

- view state;
- selection and navigation;
- renderer state for EPUB and PDF;
- optimistic UI state;
- local preference/cache acceleration.

The runtime owns:

- library item identity and metadata;
- SQLite transactions and migrations;
- filesystem access and file streaming;
- scanning and reconciliation;
- reading status and sessions;
- durable resume locations and bookmarks;
- queue transitions;
- external process launching;
- shutdown and recovery.

LocalStorage is a cache, never an authority. If it conflicts with SQLite, the
runtime value wins and the client refreshes its cache.

## API design rules

Every application command should specify:

```text
Command name
Input schema
Preconditions
Transaction boundary
State transition
Result
Retry/idempotency behavior
Observable errors
```

For example, `RecordProgress` should not accept an arbitrary client status. It
should accept a measured location and progress, then let the runtime derive the
durable status.

The API should expose a bootstrap response containing:

- protocol version;
- application version;
- runtime mode (`browser` or `desktop`);
- platform and capabilities;
- database migration version;
- readiness state.

## Candidate native bindings

Bindings may eventually own operations such as:

- native file/folder dialogs;
- application menus;
- notifications;
- tray/dock integration;
- window management;
- clipboard operations that require native behavior.

They should not duplicate ordinary library queries or reading commands merely
because the app is running in a native window.

## Security and exposure

Desktop mode must remain loopback-only. The runtime must not be changed to bind
public interfaces as part of desktop startup. File-serving routes must continue
to resolve files through library item identity rather than accepting arbitrary
paths from the client.

Diagnostics should be bounded, structured, and clearly separated from ordinary
user-facing errors. Sensitive paths and document content must not be emitted by
default.

## Migration from the current shape

1. Define typed application commands and query results.
2. Move route logic behind application services.
3. Keep HTTP handlers thin.
4. Add bootstrap/readiness semantics.
5. Add lifecycle integration tests.
6. Add bindings only for proven native capabilities.
7. Decide whether the Go server remains compatibility-only or is removed.
