# Library installer

`library-setup` is the thin, native bootstrapper for Library and its optional Readest and Sioyek integrations.

The preview installer has a Linux-only end-to-end path. It fetches a signed release manifest over HTTPS, detects the compiled target, selects the exact artifact, verifies SHA-256 and Ed25519 data, extracts the Linux tarball, creates a launcher, and activates releases through an atomic version pointer. Windows and macOS package installers remain separate work.

```bash
mise exec -- zig version
mise exec -- zig build
mise exec -- zig build test --summary all
mise exec -- zig build run -- help
mise exec -- zig build run -- verify-file <path> <sha256>
mise exec -- zig build run -- sign-manifest <payload> <output> <seed-hex>
mise exec -- zig build run -- install <signed-manifest> --root <absolute-directory>
mise exec -- zig build run -- install-url <https-signed-manifest> --root <absolute-directory>
mise exec -- zig build run -- rollback <absolute-directory>
```

The development manifest contains unresolved versions and placeholder digests. The planner can parse it, but intentionally refuses to treat it as installable.

The install path supports signed local `file://` artifacts and HTTPS acquisition. HTTPS artifacts stream into a SHA-256-addressed cache with retry handling, temporary `.part` files, declared-size checks, and verification before cache promotion. Linux `tar_gz` artifacts are extracted into `library/versions/<version>`, a `library/bin/library` launcher follows `current.txt`, and the previous version is retained in `previous.txt` and can be restored with `rollback`.

`sign-manifest` is a development fixture tool. Release CI must sign generated manifests using a protected signing secret, not a command-line seed.

The checked-in fixture can be exercised with:

```bash
SEED=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
mise exec -- zig build run -- sign-manifest fixtures/payload.json /tmp/library-manifest.signed "$SEED"
mise exec -- zig build run -- install /tmp/library-manifest.signed --root /tmp/library-install-test
```

The HTTPS downloader is compile-verified on Linux, Windows, and macOS targets. The CI download harness exercises redirects, retries, size rejection, checksum rejection, and cache promotion against a local HTTP server. HTTPS certificate-chain testing remains separate because Zig 0.16's standard client does not currently make a local test CA straightforward to inject; production downloads remain HTTPS-only by default, while `--allow-http` is an explicit test-only escape hatch.

GitHub Actions runs this Linux integration suite on installer changes and separately verifies the Windows and macOS cross-builds. The workflow is intentionally validation-only; it does not publish artifacts or releases.

The Linux host build is verified locally. The executable also cross-compiles for `x86_64-windows-gnu` and `aarch64-macos`; those targets are build-capable, not release-certified. The public `v0.1.1-preview.1` installer is explicitly experimental and Linux-only. It does not install Readest or Sioyek, create desktop entries, elevate permissions, or provide Windows/macOS package installation.

## No sudo required

The preview installer is designed for a normal user account. It does not call
`sudo`, `pkexec`, `doas`, a package manager, or a system service manager, and
it does not write to `/opt`, `/usr/local`, or another system directory.

Use a directory owned by the user, such as:

```bash
library-setup-linux-x86_64 install-url \
  https://github.com/Adjanour/library/releases/download/v0.1.1-preview.1/library-preview-manifest.signed \
  --root "${XDG_DATA_HOME:-$HOME/.local/share}/library-preview"
```

The `--root` flag is explicit so the installer never guesses where it may
write. Passing a system-owned directory would defeat the user-owned install
model and is intentionally not part of the supported preview flow.
