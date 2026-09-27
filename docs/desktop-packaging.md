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

## Windows VM validation

QEMU/KVM is suitable for an additional Windows x86_64 smoke pass when a licensed Windows image is available. Keep the VM image outside the repository. Use it to install the Windows artifact and exercise the EPUB smoke flow, shortcuts, settings, scan directories, PDF defaults, queue behavior, and progress persistence.

QEMU does not replace native Windows runner validation, and it is not a practical macOS validation path from Linux. CEF rendering, GPU behavior, signing, and OS integration still require the target platform.

## Packaging boundaries

The current workflow does not yet provide Windows MSI metadata, macOS signing/notarization, Linux package metadata, automatic update channels, or native-device EPUB smoke tests on Windows and macOS. Those are release-certification work.
