# Getting started

This guide is for contributors who want to run Library locally and verify a change.

## Prerequisites

- Go 1.25+
- Node.js 22+
- pnpm 10+
- Deno 2.9.6+
- Zig 0.16.0 through mise for installer work

Poppler (`pdfinfo`, `pdftotext`) and `unzip` improve metadata extraction but are optional.

## Build the web app

```bash
pnpm install --dir web/svelte --frozen-lockfile
pnpm --dir web/svelte run build
make build
./bin/server --scan
```

Open `http://localhost:8080`.

## Choose scan directories

The Deno web and desktop UI exposes scan-directory settings. Open Settings, add the folders containing books or papers, and save; the selection is persisted locally and reused after restart.

The legacy Go server command above keeps its compatibility defaults (`Documents`, `Downloads`, and `Books` under the current user's home directory). It does not yet consume the Deno settings database.

For frontend hot reload:

```bash
./dev.sh
```

## Build the desktop app

```bash
pnpm install --dir web/svelte --frozen-lockfile
pnpm --dir web/svelte run build
deno task --cwd deno check
deno task --cwd deno test
deno task --cwd deno desktop
```

The Linux package is emitted under `dist/app/`.

## Run tests

```bash
go test ./...
deno task --cwd deno test
mise exec -- zig build test --summary all
bash installer/tests/https_integration.sh
```

The installer integration harness uses a local HTTP server only for deterministic retry and redirect tests. Production artifact acquisition remains HTTPS-only unless `--allow-http` is explicitly supplied for a test.
