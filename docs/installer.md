# Installer guide

The installer is a small Zig 0.16.0 bootstrapper under `installer/`, separated from the application runtime.

## Trust model

A signed manifest contains the target platform, package version, artifact URL, size, and SHA-256 digest. The installer verifies the Ed25519 signature before parsing the manifest, then verifies the artifact digest before installation.

The development-only signer is useful for fixtures:

```bash
mise exec -- zig build run -- sign-manifest <payload.json> <manifest.signed> <seed-hex>
```

Release signing must happen in protected CI with a secret-managed key. Never commit or pass a production signing key as a normal shell argument.

## Build and test

```bash
mise exec -- zig build test --summary all
mise exec -- zig build --summary all
mise exec -- zig build -Dtarget=x86_64-windows-gnu --summary all
mise exec -- zig build -Dtarget=aarch64-macos --summary all
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

The public preview installer is experimental and Linux-only. Platform-specific shortcuts, file associations, release signing policy, and Readest/Sioyek payload installation are not complete. Windows and macOS binaries are build-capable but do not have public installer packages yet. A future polished installer must preserve the same no-sudo, user-owned installation model on every platform.
