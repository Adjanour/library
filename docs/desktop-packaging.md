# Desktop packaging

Library Desktop is built with Deno Desktop using the CEF backend. The package contains the Deno runtime, Library server, Svelte frontend, and browser engine in one platform-specific bundle.

## Local Linux build

```bash
pnpm install --dir web/svelte --frozen-lockfile
pnpm --dir web/svelte run build
deno task --cwd deno desktop
```

The output is `dist/app/`; the executable is `dist/app/app`.

Validate the packaged binary under a virtual display:

```bash
xvfb-run -a installer/scripts/validate-desktop-launch.sh dist/app/app
```

When a packaged EPUB smoke test is needed, seed a temporary database and run:

```bash
xvfb-run -a installer/scripts/validate-desktop-epub.sh \
  dist/app/app /tmp/library-smoke.db /tmp/library-smoke.epub
```

This generates a minimal EPUB fixture, starts the packaged app with that item selected, and waits for a successful rendition-attempt diagnostic. On failure it prints the per-method timing and iframe state captured by the reader.

The validator waits for the embedded server, requests `/api/health`, and asks the app to quit cleanly.

## CI builds

`.github/workflows/desktop.yml` runs on native GitHub-hosted runners:

- Ubuntu builds the Linux CEF package, launches it under Xvfb, and uploads a tarball.
- Windows builds the Windows CEF artifact and uploads it for inspection.
- macOS builds the Apple Silicon CEF artifact and uploads it for inspection.

These are validation artifacts, not signed public installers.

## Package size and tester distribution

The desktop bundle is intentionally larger than the web application because
it includes the Deno runtime, Library server, Svelte assets, and the CEF browser
engine required for consistent EPUB rendering. The latest CI artifacts were
approximately 181 MB for Linux, 214 MB for Windows, and 386 MB for Apple
Silicon macOS.

For the preview, do not ask every tester to download every platform. Send the
matching artifact only to one or two testers on each operating system. The web
application is the lighter path for general feedback, while native desktop
artifacts are reserved for platform-specific reader and packaging checks.

Before a wider release, revisit the bundle with measurements rather than
guesswork:

1. Generate a file-level size report for every platform artifact.
2. Remove unused runtime files, locales, source maps, and duplicate assets when
   the packaged reader does not need them.
3. Publish compressed, platform-specific archives with checksums.
4. Keep the installer small and let it fetch the verified platform payload
   into a user-owned directory.
5. Compare the download and installed sizes against the web version before
   choosing a default distribution path.

Do not remove CEF or reader assets solely to reduce download size. EPUB
reliability and consistent rendering remain more important than matching the
size of a browser-only application.

## Windows VM validation

QEMU/KVM is suitable for an additional Windows x86_64 smoke pass when a licensed Windows image is available. Keep the VM image outside the repository. Use it to install the Windows artifact and exercise the EPUB smoke flow, shortcuts, settings, scan directories, PDF defaults, queue behavior, and progress persistence.

QEMU does not replace native Windows runner validation, and it is not a practical macOS validation path from Linux. CEF rendering, GPU behavior, signing, and OS integration still require the target platform.

## Packaging boundaries

The current workflow does not yet provide Windows MSI metadata, macOS signing/notarization, Linux package metadata, automatic update channels, or native-device EPUB smoke tests on Windows and macOS. Those are release-certification work.
