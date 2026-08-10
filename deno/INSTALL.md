# How to Build & Install a Deno Desktop App

A step-by-step guide from the Library project.

## Prerequisites

- Deno 2.9+ (`deno --version`)
- A frontend framework (SvelteKit, Next.js, etc.) or plain HTML
- `deno desktop` CLI (included in Deno 2.9+)

## Step 1: Project Structure

```
my-app/
├── deno.json          # Config + desktop settings
├── src/
│   └── main.ts        # Your HTTP server
├── web/
│   └── static/        # Built frontend files
└── icon.png           # App icon (512x512 PNG)
```

## Step 2: Configure deno.json

```jsonc
{
  "name": "my-app",
  "version": "1.0.0",
  "exports": "./src/main.ts",
  "tasks": {
    "dev": "deno run --allow-all --watch src/main.ts",
    "desktop": "deno desktop --allow-all --include ../web/static src/main.ts",
    "build:frontend": "cd ../web/svelte && npm run build"
  },
  "desktop": {
    "app": {
      "name": "My App",
      "identifier": "com.myname.myapp",
      "icons": {
        "linux": "./icon.png"
      }
    },
    "backend": "webview",
    "output": {
      "linux": "../dist/app"
    }
  }
}
```

### Key points:
- `"exports"` — entry point for `deno desktop`
- `"--include ../web/static"` — embeds frontend files in the binary
- `"backend": "webview"` — uses OS native webview (small binary)
- `"output"` — where the built app goes

## Step 3: Write Your Server

```typescript
import { join, dirname, fromFileUrl } from "@std/path";

Deno.serve((req) => {
  const url = new URL(req.url);

  // API routes
  if (url.pathname === "/api/hello") {
    return Response.json({ hello: "world" });
  }

  // Static file serving (for frontend)
  // ... serve files from your static directory
});
```

### Important: `deno desktop` picks its own port

When running as a desktop app:
- `Deno.serve()` ignores the port you pass
- The runtime sets `DENO_SERVE_ADDRESS` env var
- The webview auto-connects to that port

```typescript
// Works for both desktop and standalone
const port = parseInt(Deno.args[0] ?? "3000");
const addr = Deno.env.get("DENO_SERVE_ADDRESS");
const actualPort = addr ? parseInt(addr.split(":").pop()!) : port;
console.log(`Server on port ${actualPort}`);
Deno.serve({ port }, app.fetch);
```

## Step 4: Embed Static Files

The `--include` flag embeds files in the binary:

```bash
deno desktop --allow-all --include ../web/static src/main.ts
```

At runtime, files are extracted to a temp directory. Your code needs to find them:

```typescript
// Convert file:// URL to filesystem path
const staticDir = join(
  dirname(fromFileUrl(import.meta.url)),
  "..", "..", "web", "static"
);
```

## Step 5: Build the Frontend

For SvelteKit with adapter-static:

```bash
cd web/svelte && npm run build
```

Output goes to `web/static/` (configured in `svelte.config.js`).

## Step 6: Build the Desktop App

```bash
# Build frontend first
deno task build:frontend

# Then build desktop binary
deno task desktop
```

Output: `dist/app/` with launcher (`app`) and binary (`app.so`).

## Step 7: Install System-Wide

```bash
# Create directories
mkdir -p ~/.local/bin ~/.local/share/icons ~/.local/share/applications

# Copy binary
cp dist/app/app ~/.local/bin/myapp
cp dist/app/app.so ~/.local/bin/myapp.so

# Copy icon
cp icon.svg ~/.local/share/icons/myapp.svg
cp icon.png ~/.local/share/icons/myapp.png

# Create .desktop entry
cat > ~/.local/share/applications/myapp.desktop << 'EOF'
[Desktop Entry]
Name=My App
Comment=Description here
Exec=/home/user/.local/bin/myapp
Icon=/home/user/.local/share/icons/myapp.png
Type=Application
Categories=Utility;
Terminal=false
EOF

# Make executable
chmod +x ~/.local/bin/myapp ~/.local/bin/myapp.so
chmod +x ~/.local/share/applications/myapp.desktop

# Update desktop database
update-desktop-database ~/.local/share/applications/
```

## Step 8: Run It

```bash
# From terminal
~/.local/bin/myapp

# Or search in app launcher
```

## Debugging

### "Server not ready after 15s"
This is a warning, not an error. The webview waits 15s then navigates anyway. Your server is probably fine.

### Static files return 404
- Check `--include` flag is set
- Use `fromFileUrl(import.meta.url)` to fix `file://` prefix
- Verify files exist at the source path

### Frontend API calls return 404
- Check all endpoints the frontend calls (grep for `/api/`)
- Add stubs for endpoints you haven't implemented yet
- Check HTTP methods (GET vs POST)

## Distribution

For Linux, you can create:
- **AppImage**: Single-file bundle
- **deb**: Debian/Ubuntu package
- **rpm**: Fedora/RHEL package

```bash
deno desktop --output ../dist/myapp.AppImage src/main.ts
deno desktop --output ../dist/myapp.deb src/main.ts
```

## Learning Resources

### Deno Desktop
- [Official docs](https://docs.deno.com/runtime/desktop/)
- [Configuration](https://docs.deno.com/runtime/desktop/configuration/)
- [HTTP serving](https://docs.deno.com/runtime/desktop/serving/)
- [Backends](https://docs.deno.com/runtime/desktop/backends/)
- [Auto-update](https://docs.deno.com/runtime/desktop/auto_update/)
- [Distribution](https://docs.deno.com/runtime/desktop/distribution/)

### Deno Basics
- [Deno handbook](https://deno.com/manual)
- [TypeScript in Deno](https://docs.deno.com/runtime/fundamentals/typescript/)
- [Node compat](https://docs.deno.com/runtime/fundamentals/node/)

### Frontend (SvelteKit)
- [SvelteKit docs](https://kit.svelte.dev/)
- [adapter-static](https://kit.svelte.dev/docs/adapter-static)

### SQLite
- [node:sqlite](https://docs.deno.com/runtime/reference/node-api-reference/#sqlite)

## Common Patterns

### Result Pattern (TypeScript)
```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function doSomething(): Result<string, Error> {
  if (failed) return { ok: false, error: new Error("failed") };
  return { ok: true, value: "success" };
}
```

### Hono Router
```typescript
import { Hono } from "hono";
const app = new Hono();

app.get("/api/items/:id", (c) => {
  const id = c.req.param("id");
  return Response.json({ id });
});

Deno.serve(app.fetch);
```

### Zod Validation
```typescript
import { z } from "zod";

const Schema = z.object({
  id: z.coerce.number(),
  name: z.string().min(1),
});

const result = Schema.safeParse({ id: "123", name: "test" });
if (!result.success) {
  return Response.json({ error: result.error.message }, { status: 400 });
}
```
