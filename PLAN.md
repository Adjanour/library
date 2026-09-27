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

The preview must not imply Windows/macOS signing, notarization, installer metadata, or real-device EPUB verification.

## Next engineering slices

### 1. Native desktop validation

- Run the packaged EPUB smoke test on a clean Windows VM using QEMU/KVM.
- Validate the Windows artifact on the native GitHub runner.
- Validate the macOS artifact on real Apple hardware or a native Apple runner.
- Verify shortcuts, reader preferences, scan-directory persistence, queue behavior, progress durability, PDF zoom, and EPUB opening on each platform.

### 2. Release packaging

- Produce platform-specific installer metadata.
- Add Windows signing and macOS signing/notarization when credentials and runners are available.
- Generate release artifacts, checksums, and a protected signed manifest.
- Exercise upgrade and rollback from the previous preview.

### 3. Reader hardening

- Re-test the diagnostic path against real-world EPUBs that previously failed in the webview.
- Keep EPUB opening under one second for warmed books and measure cold-start stages.
- Add native-device smoke coverage for EPUB, PDF, shortcuts, settings, and progress.
- Keep the web reader and CEF reader behavior aligned.

### 4. Product polish

- Improve error toasts and actionable recovery states.
- Add loading skeletons where they improve perceived performance.
- Add recent books and tag click-to-filter only if they remain useful without dashboard clutter.
- Continue accessibility and keyboard-navigation audits.

## Explicit non-goals for the preview

- Claiming Windows or macOS release certification.
- Silent installation of Readest or Sioyek.
- Automatic elevation or OS-level integration without user consent.
- Publishing unsigned or unverified platform installers.
- Replacing the native macOS validation gate with QEMU on Linux.

## Release gates

A certified `v0.1.1` requires every gate in [`docs/release-readiness.md`](docs/release-readiness.md) to be green. Until then, use prerelease names such as `v0.1.1-preview.1` and keep the limitations visible.
