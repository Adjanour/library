# Library Web Preview

The Web Preview is the local browser version of Library. It serves the
production Svelte interface from the Deno API, so books remain on the tester's
machine and the application can scan local folders, read files, and persist
state in SQLite.

## Requirements

- Deno 2.9.6 or newer
- A browser with JavaScript enabled

No account, hosted database, or administrator access is required.

## Run the release bundle

Download `library-web-preview.tar.gz` from the Library preview release, then:

```bash
tar -xzf library-web-preview.tar.gz
cd library-web-preview
./start-web-preview.sh
```

Open <http://localhost:8080>. To use another port:

```bash
./start-web-preview.sh 9090
```

The first run may download Deno module dependencies. The launcher does not
install system packages or require `sudo`.

## Choose library folders

Open Settings, add the folders containing books or papers, and save. Library
validates the paths, scans them recursively, and stores the configuration in
the local application data directory.

## Development mode

From the repository root:

```bash
pnpm install --dir web/svelte --frozen-lockfile
pnpm --dir web/svelte run build
deno task --cwd deno start
```

Use `./dev.sh` when working on the Svelte interface with hot reload.

## Scope

This is a local web release, not a hosted multi-user service. A hosted version
would need a different storage and privacy model because the current API reads
local files and writes local SQLite state.
