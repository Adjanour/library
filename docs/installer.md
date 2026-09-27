# Installer guide

The installer is a small Zig 0.16.0 bootstrapper under `installer/`, separated from the application runtime.

## Trust model

A signed manifest contains the target platform, package version, artifact URL, size, and SHA-256 digest. The public Web Preview command pins the release Ed25519 public key in the installer, verifies the signature before parsing the manifest, and then verifies every artifact digest before installation. A manifest cannot substitute a different signing key.

The development-only signer is useful for fixtures:

```bash
mise exec -- zig build run -- sign-manifest <payload.json> <manifest.signed> <seed-hex>
```

Release signing must happen in protected CI with a secret-managed key. Never commit or pass a production signing key as a normal shell argument.

## Web Preview setup

Running a published setup binary without arguments selects `web-preview`. The
installer:

1. chooses the current user's platform data directory
2. fetches the pinned signed manifest over HTTPS
3. downloads the matching Deno runtime and Library Web Preview ZIP
4. checks declared sizes and SHA-256 digests
5. extracts both payloads without calling a system archive utility
6. caches the dependencies locked by `deno.lock`
7. writes atomic current-version pointers and a reusable launcher
8. starts Library and opens the browser

Use `web-preview --no-launch` to install without starting the server. The
platform defaults are `%LOCALAPPDATA%\Library Preview` on Windows,
`~/Library/Application Support/Library Preview` on macOS, and
`$XDG_DATA_HOME/library-preview` or `~/.local/share/library-preview` on Linux.

## Build and test

```bash
mise exec -- zig build test --summary all
mise exec -- zig build --summary all
mise exec -- zig build -Dtarget=x86_64-windows-gnu --summary all
mise exec -- zig build -Dtarget=x86_64-macos --summary all
mise exec -- zig build -Dtarget=aarch64-macos --summary all
bash tests/web_preview_integration.sh
```

## Versioned installation

```bash
mise exec -- zig build run -- install <manifest.signed> --root <absolute-directory>
```

Installs are stored as `library/current.txt`, `library/previous.txt`, and `library/versions/<version>/`. The active pointer changes only after download, checksum verification, staging, and receipt creation succeed.

For the Linux preview installer, use the signed remote manifest:

```bash
library-setup-linux-x86_64 install-url \
  https://github.com/Adjanour/library/releases/download/v0.1.1-preview.1/library-preview-manifest.signed \
  --root "$HOME/.local/share/library-preview"
```

The Linux tarball is extracted into the selected version directory and the launcher is written to `library/bin/library`.

### User-owned installation

The installer must not require administrator access. It performs no elevation,
package-manager, or system-service operations and writes only below the
directory supplied with `--root`. The supported preview command uses a
user-owned data directory:

```bash
--root "${XDG_DATA_HOME:-$HOME/.local/share}/library-preview"
```

Do not use `/opt`, `/usr/local`, or another system-owned directory for the
preview. Keeping the installation under the user's data directory makes the
launcher, version pointers, rollback state, and downloaded artifacts writable
without `sudo`.

## Rollback

```bash
mise exec -- zig build run -- rollback <absolute-directory>
```

Rollback swaps `current.txt` and `previous.txt` after confirming the target version exists.

## Current limitations

The Web Preview setup path is published for Linux x86_64, Windows x86_64,
Intel macOS, and Apple Silicon macOS. The Windows and macOS binaries remain
experimental until code signing, notarization, installer metadata, and native
device testing are complete. Desktop shortcuts, file associations, automatic
updates, Readest, and Sioyek installation remain follow-up work.
