# Application lifecycle

Status: proposed design

This document defines how Library starts, becomes usable, runs, and shuts down.
It is intentionally written before implementation changes so lifecycle behavior
can be tested rather than inferred from side effects.

## System shape

```text
Desktop shell
  owns the native window
        │
        ▼
Application runtime
  owns durable state, side effects, and the local API
        │
        ▼
Client
  renders the UI and document readers
```

The browser preview runs the same runtime/client relationship without the
desktop shell. The desktop build uses Deno Desktop with a CEF renderer. CEF is
the rendering backend; it is not the domain or transport boundary.

## Process states

```text
Created
  → Booting
  → DatabaseReady
  → HttpReady
  → WindowLoading
  → Ready
  → Running
  → Draining
  → Stopped
```

Any boot state may transition to `Failed`. A failed startup must report the
failed stage and must not present a window that appears usable.

### Created

No resources have been acquired. The process has only received its launch
configuration.

### Booting

The runtime resolves platform paths, configuration, permissions, logging, and
error handling. No client request should be considered valid yet.

### DatabaseReady

SQLite is open, migrations have completed, schema invariants have been checked,
and stale reading sessions have been reconciled. The database is now the source
of truth for durable state.

### HttpReady

The application API is listening on the runtime-selected loopback address. The
runtime knows its actual base URL and can answer health/readiness requests.

### WindowLoading

The desktop shell has created or adopted its initial window and navigated it to
the local application URL. The client has not yet completed bootstrap.

### Ready

The client has loaded, verified the runtime protocol, and fetched its initial
bootstrap state. User actions may now be accepted.

### Running

Normal operation. Scans, reads, progress writes, and UI queries are handled by
the runtime and client according to their ownership boundaries.

### Draining

Shutdown has begun. New long-running work is rejected or queued, active scans
are cancelled where possible, progress writes are flushed, active sessions are
closed, and SQLite is closed before process exit.

## Startup contract

The startup sequence must be observable as stages:

1. Resolve configuration and data paths.
2. Open SQLite.
3. Apply ordered migrations.
4. Reconcile stale sessions.
5. Construct domain services.
6. Construct HTTP routes.
7. Bind the runtime-selected loopback address.
8. Create/adopt the desktop window.
9. Load the client.
10. Complete client bootstrap.

The client must not guess readiness from a timer. It should call an explicit
bootstrap/readiness endpoint and receive the runtime version, protocol version,
database state, and supported capabilities.

## Shutdown contract

Shutdown is an application operation, not a browser-page side effect.

The runtime must support:

- explicit application quit;
- native window close;
- operating-system termination signals where available;
- startup failure cleanup;
- unexpected client disappearance;
- cancellation of an active scan.

Shutdown should be idempotent. Calling it twice must not corrupt the database or
double-close sessions.

The native window lifecycle and runtime lifecycle must be connected explicitly.
Closing a Deno Desktop window does not by itself guarantee that the runtime has
stopped, so this is a required integration boundary rather than an assumption.

## Required lifecycle tests

- database migration failure produces `Failed` and no usable window;
- client cannot declare the app ready before bootstrap succeeds;
- a second quit request is harmless;
- closing the desktop window closes active reading sessions;
- an interrupted scan does not leave a half-written item;
- a runtime restart preserves progress, queue, bookmarks, and settings;
- the browser preview and desktop app expose the same application API contract.
