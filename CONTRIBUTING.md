# Contributing to Library

Thanks for helping improve Library. The project is local-first, and changes should preserve fast startup, predictable reading behavior, and clear user control over files and settings.

## Before you start

Read:

- [`PLAN.md`](PLAN.md) for current priorities and release boundaries.
- [`docs/getting-started.md`](docs/getting-started.md) for local setup.
- [`docs/release-readiness.md`](docs/release-readiness.md) before changing packaging or reader behavior.

Use a focused branch name such as `feature/epub-diagnostics`, `fix/reader-timeout`, or `docs/contributing`. Do not use `codex` as a branch name.

## Development loop

Install frontend dependencies and build the web assets:

```bash
pnpm install --dir web/svelte --frozen-lockfile
pnpm --dir web/svelte run build
```

Run the checks relevant to your change:

```bash
go test ./...
deno check deno/src/**/*.ts
deno task --cwd deno test
mise exec -- zig build test --summary all
bash installer/tests/https_integration.sh
```

For desktop work, build and validate the packaged Linux app:

```bash
deno task --cwd deno desktop
xvfb-run -a installer/scripts/validate-desktop-launch.sh dist/app/app
xvfb-run -a installer/scripts/validate-desktop-epub.sh \
  dist/app/app /tmp/library-smoke.db /tmp/library-smoke.epub
```

## Change guidelines

- Add or update a focused test with behavior changes.
- Keep user-facing failures actionable and preserve diagnostic context for reader failures.
- Do not overwrite manually corrected metadata automatically.
- Treat EPUB and PDF files as untrusted input; avoid assuming a valid archive, XML document, or metadata field.
- Keep cache limits, cancellation, and cleanup explicit for large books.
- Preserve keyboard access and visible focus states.
- Avoid adding motion, dashboard clutter, or browser-native-looking controls without a clear product reason.
- Keep installers user-owned. Do not add `sudo`, elevation prompts, package-manager calls, or writes to system directories as part of normal installation.
- Update `CHANGELOG.md`, `PLAN.md`, or a focused guide when behavior or release status changes.

## Pull requests

A good pull request explains:

1. What user problem it solves.
2. What changed and why.
3. How it was tested.
4. Any platform, fixture, signing, or release limitations that remain.

Keep unrelated formatting or generated build output out of the change. Do not commit local databases, downloaded books, credentials, signed release keys, or platform-specific VM images.

## Commit and release hygiene

- Use concise imperative commit messages.
- Do not add `Co-Authored-By` trailers unless explicitly requested.
- Keep releases honest: preview artifacts must say preview, and certified platform support requires native validation plus signing requirements.
- Never commit production installer signing keys or embed secrets in manifests.
