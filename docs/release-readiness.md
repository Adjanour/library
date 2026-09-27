# Release readiness

This document defines what must be true before publishing a certified Library release.

## Current state

Linux is the verified release target. Windows and macOS are build-capable through native CI jobs, but are not certified.

## Automated gates

- Go tests pass.
- Deno checks and tests pass.
- Svelte production build passes.
- Zig installer tests pass.
- Installer download integration passes.
- Linux packaged binary launches and answers `/api/health`.
- Windows and macOS native CI builds complete.

## Native platform gates

- Windows artifact launches on a clean Windows machine.
- macOS artifact launches on a clean Apple Silicon machine.
- EPUB opens in the packaged CEF reader on Windows and macOS.
- PDF preview opens at the expected 120% default.
- Keyboard shortcuts, settings, queue operations, and progress persistence work in packaged builds.
- User-selected scan directories survive restart.

## Distribution gates

- Windows executable or MSI is signed.
- macOS app is signed and notarized.
- Linux artifact has reproducible version metadata and signed checksums.
- Artifact URLs, sizes, and SHA-256 values are generated automatically.
- The public manifest is signed with a protected CI key.
- Upgrade and rollback are tested from the previous release.

## Release sequence

1. Build and test web and desktop artifacts.
2. Run native platform smoke tests.
3. Generate the release manifest from immutable artifacts.
4. Sign the manifest and checksums in protected CI.
5. Stage the release as a draft.
6. Install the draft artifact on each supported platform.
7. Verify the packaged reader and rollback.
8. Publish only after every gate is green.

## First-release non-goals

- Silent installation of Readest or Sioyek.
- Automatic OS-level elevation without user consent.
- Declaring Windows or macOS certified from cross-build success alone.
- Publishing while the packaged CEF EPUB path is unverified on the target device.
