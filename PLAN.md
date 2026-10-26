# Library plan

This is the current product and release plan. Historical implementation plans live under [`docs/archive/`](docs/archive/).

## Current state

Library is a local-first reading workspace with:

- SvelteKit web UI and a Deno TypeScript backend.
- Linux, Windows, and macOS desktop build workflows using Deno Desktop and CEF.
- EPUB and range-streamed PDF readers.
- Durable reading progress, sessions, queue operations, bookmarks, search, and reader preferences.
- Configurable persisted scan directories in the Deno UI.
- EPUB covers, metadata fallbacks, bounded cancellable EPUB caching, and PDF first-page previews.
- Zig 0.16.0 installer foundations with signed manifests, checksum verification, versioned installs, and rollback.
- A packaged Linux EPUB smoke test with a generated fixture and per-attempt diagnostics.

## Shareable now

The next public artifact is `v0.1.1-preview.1`:

- Web application: shareable as a preview build.
- Linux desktop: locally packaged and EPUB-smoke-tested.
- Windows: native CI build-capable; not certified.
- macOS: native CI build-capable; not certified.
- Installer: development and validation foundation; not yet a polished public installer.

The Linux preview installer is now available as an explicitly experimental binary. It installs the preview archive from a signed remote manifest, creates a launcher, and supports rollback. Its supported flow is user-owned and never requires `sudo`.

The preview must not imply Windows/macOS signing, notarization, installer metadata, or real-device EPUB verification.

## Next engineering slices

### 0. Correctness foundation

Implemented in the current working slice:

- Unreadable scan roots no longer cause missing-file decisions.
- Missing files are soft-marked and retain progress, sessions, and queue data.
- UI deletion is an ignore operation; ignored items stay hidden and are not reactivated by scans.
- Manual metadata edits are recorded as locked fields and survive scanner upserts.
- Search ordering has a stable `id` tiebreaker and excludes ignored items.
- Reading progress input is validated at the API boundary.
- First-page title extraction rejects continuation lines and records title provenance.

The migration fixture and API-level regression coverage for these behaviors are now in place.

### 1. Reading-state and search foundation

Implemented in the current Phase 1 slice:

- Reading status is derived from reported progress instead of trusting client status.
- Opening a session does not create a misleading zero-progress reading row.
- Reaching 100 percent creates durable finished progress.
- Reader progress writes are atomic from the client perspective: readers send one measurement request, and the server preserves furthest progress while updating the current resume page.
- EPUB resume locations are stored in the migrated `reading_progress.location` field, with local storage retained as a fast cache.
- Reading sessions have activity timestamps, visible-reader heartbeats, stale-session cleanup, and shutdown cleanup through `/api/quit`.
- Reading dashboards order active books by most recent activity.
- Search results include the matching progress state when one exists.

Implemented in the current migration slice:

- Databases now use ordered `PRAGMA user_version` migrations.
- Legacy on-disk databases receive a user-owned `.bak-5` backup before migration.
- A legacy-schema fixture verifies migration, data preservation, idempotence, and backup creation.

Implemented in the completed Phase 1 API slice:

- Cursor-compatible search with page-based compatibility.
- Repeatable type, category, tag, purpose, and status filters.
- Facet counts that exclude the facet's own filter.
- Search results with joined reading progress.
- Bulk metadata edits with batch audit history and undo.
- Explicit dropped-reading transition endpoint.

Still outstanding in this phase:

- Queue-to-reading promotion behavior and the redesigned route structure.
- A format-neutral PDF resume value shared across web and desktop origins.

### 2. Native desktop validation

- Run the packaged EPUB smoke test on a clean Windows VM using QEMU/KVM.
- Validate the Windows artifact on the native GitHub runner.
- Validate the macOS artifact on real Apple hardware or a native Apple runner.
- Verify shortcuts, reader preferences, scan-directory persistence, queue behavior, progress durability, PDF zoom, and EPUB opening on each platform.

### 3. Release packaging

- Produce platform-specific installer metadata.
- Add Windows signing and macOS signing/notarization when credentials and runners are available.
- Generate release artifacts, checksums, and a protected signed manifest.
- Exercise upgrade and rollback from the previous preview.
- Publish only the matching platform build to each tester; do not make every tester download all desktop bundles.
- Measure and reduce desktop bundle size before broad release. Keep CEF and the reader assets required for reliable EPUB rendering.
- Produce a file-level size report, remove unused packaged files, and compare compressed download size with installed size.
- Keep a small user-owned bootstrapper as the preferred future distribution path, with the verified platform payload fetched separately.

### 4. Reader hardening

- The reader findings and proposed state model are recorded in [`docs/design/reader-redesign.md`](docs/design/reader-redesign.md).
- Client progress writes now use one atomic server update that derives status and preserves furthest progress.
- EPUB resume locations and bookmarks are durable in SQLite; local storage remains a cache. PDF resume still needs to move fully to the same durable model.
- Session heartbeat, active-time accumulation, visibility or idle handling, orphan cleanup, and shutdown-time session closure are implemented.
- Hide iframe probes and raw EPUB traces behind diagnostics mode with a copyable diagnostics action.
- Treat the native desktop window-close lifecycle as a separate Deno Desktop integration issue. `Super + W` closes the Hyprland window, but the current backend may survive until explicit `/api/quit`.
- Re-test the diagnostic path against real-world EPUBs that previously failed in the webview.
- Keep EPUB opening under one second for warmed books and measure cold-start stages.
- Add native-device smoke coverage for EPUB, PDF, shortcuts, settings, and progress.
- Keep the web reader and CEF reader behavior aligned.

### 5. Product polish

- Improve error toasts and actionable recovery states.
- Add loading skeletons where they improve perceived performance.
- Add recent books and tag click-to-filter only if they remain useful without dashboard clutter.
- Continue accessibility and keyboard-navigation audits.

## Explicit non-goals for the preview

- Claiming Windows or macOS release certification.
- Silent installation of Readest or Sioyek.
- Automatic elevation or OS-level integration without user consent.
- Requiring administrator access for the normal install, update, launch, or rollback flow.
- Publishing unsigned or unverified platform installers.
- Replacing the native macOS validation gate with QEMU on Linux.

## Release gates

A certified `v0.1.1` requires every gate in [`docs/release-readiness.md`](docs/release-readiness.md) to be green. Until then, use prerelease names such as `v0.1.1-preview.1` and keep the limitations visible.
