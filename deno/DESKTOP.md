# Deno Desktop

## What It Is

A compiler that turns your Deno app into a standalone binary. It bundles your TypeScript code, the Deno runtime, and a web rendering engine into a single executable per platform.

## Architecture

```
┌─────────────────────────────┐
│         Your App            │
│  ┌───────────┬───────────┐  │
│  │  Deno     │  Webview  │  │
│  │  Runtime  │  (native) │  │
│  │           │           │  │
│  │  HTTP     │  Renders  │  │
│  │  Server   │  HTML/CSS │  │
│  └───────────┴───────────┘  │
└─────────────────────────────┘
```

Your `Deno.serve()` handler runs on a local port. The webview navigates to `http://localhost:PORT`. They communicate through in-process channels, not network calls.

## How It Works

1. Takes your TypeScript code + Deno runtime + a web rendering engine
2. Bundles them into a single executable per platform
3. Your app runs inside a native window (webview) instead of a browser
4. The webview loads your frontend, which calls the Deno API on the same port

## Comparison

| Feature | deno desktop | Electron | Tauri |
|---------|-------------|----------|-------|
| Backend | Deno (TypeScript) | Node.js | Rust |
| Frontend | Webview (native) | Chromium (bundled) | Webview (native) |
| Binary Size | ~10-20MB | ~150MB | ~10-20MB |
| Cross-compile | Yes | Yes | Yes |
| Auto-update | Built-in | Manual | Manual |

## Key Features

- **Small binaries**: Uses OS's built-in webview, not bundled Chromium
- **Framework auto-detection**: Works with Next.js, SvelteKit, Astro, etc.
- **Cross-compile**: Build for macOS, Windows, Linux from one machine
- **Auto-update**: Built-in mechanism with binary-diff patches
- **Native integrations**: Menus, tray icons, notifications, dialogs

## Configuration

All configuration lives in the `desktop` block in `deno.json`:

```jsonc
{
  "name": "my-app",
  "version": "1.0.0",
  "exports": "./src/main.ts",
  "desktop": {
    "app": {
      "name": "My App",
      "identifier": "com.example.myapp"
    },
    "backend": "webview",
    "output": {
      "linux": "./dist/my-app"
    }
  }
}
```

## Commands

```bash
# Development with hot reload
deno desktop --hmr main.ts

# Build for current platform
deno desktop --output ./dist/my-app main.ts

# Cross-compile for specific platform
deno desktop --target x86_64-pc-windows-msvc --output ./dist/my-app.exe main.ts

# Build for all platforms
deno desktop --all-targets main.ts
```

## Backend Options

- **webview** (default): Uses OS's native webview. Smaller binaries, platform-specific rendering.
- **cef**: Bundled Chromium. Identical rendering across platforms. Larger binaries.
- **raw**: Raw WebGPU rendering. For GPU-intensive apps.

## Distribution Formats

| Platform | Extensions |
|----------|-----------|
| macOS | `.app`, `.dmg` |
| Windows | Directory, `.msi` |
| Linux | Directory, `.AppImage`, `.deb`, `.rpm` |

## Auto-Update

Configure a release server:

```jsonc
{
  "desktop": {
    "release": {
      "baseUrl": "https://releases.example.com/my-app"
    }
  }
}
```

The runtime automatically:
1. Fetches `<baseUrl>/latest.json`
2. Downloads binary-diff patches
3. Applies updates
4. Rolls back on failed launches

## For Our Library App

The desktop setup:
1. `main.ts` starts `Deno.serve()` with API routes + static file serving
2. `web/static/` contains the built SvelteKit frontend
3. `deno desktop` bundles everything into a single binary
4. Users see a native window with the library app, no browser needed

Build commands:
```bash
cd deno
deno task build:frontend  # Build SvelteKit to web/static/
deno task desktop         # Build desktop binary
```

The binary will be at `dist/app/`.
