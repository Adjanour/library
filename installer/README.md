# Library installer

`library-setup` is the thin, native bootstrapper for Library and its optional Readest and Sioyek integrations.

The installer has two preview paths. The default Desktop Preview path installs
the matching native CEF application bundle for the current OS and architecture.
The explicit Web Preview path installs a private Deno runtime and the small
browser bundle on Linux, Windows, and macOS without requiring a package manager
or administrator access.

```bash
mise exec -- zig version
mise exec -- zig build
mise exec -- zig build test --summary all
mise exec -- zig build run -- help
mise exec -- zig build run
mise exec -- zig build run -- desktop-preview --no-launch
mise exec -- zig build run -- web-preview --no-launch
mise exec -- zig build run -- verify-file <path> <sha256>
mise exec -- zig build run -- sign-manifest <payload> <output> <seed-hex>
mise exec -- zig build run -- install <signed-manifest> --root <absolute-directory>
mise exec -- zig build run -- install-url <https-signed-manifest> --root <absolute-directory>
mise exec -- zig build run -- rollback <absolute-directory>
```

The development manifest contains unresolved versions and placeholder digests. The planner can parse it, but intentionally refuses to treat it as installable.

The install path supports signed local `file://` artifacts and HTTPS acquisition. HTTPS artifacts stream into a SHA-256-addressed cache with retry handling, temporary `.part` files, declared-size checks, and verification before cache promotion. Linux `tar_gz` artifacts are extracted into `library/versions/<version>`, a `library/bin/library` launcher follows `current.txt`, and the previous version is retained in `previous.txt` and can be restored with `rollback`.

The public `desktop-preview` command and the explicit `web-preview` command
both pin the release public key rather than trusting a key supplied by the
manifest. Desktop Preview downloads the matching native CEF archive, extracts
it into versioned user-owned storage, writes current and previous pointers, and
creates a native launcher. Linux receives a user application-menu entry and
macOS receives `~/Applications/Library.app`. Running the setup binary without
a command selects Desktop Preview.

Web Preview keeps its private Deno runtime under the chosen user-owned root,
caches locked dependencies into that root, writes version pointers, and
creates a launcher that opens the local browser interface. Linux receives a
user application-menu entry and macOS receives `~/Applications/Library Web
Preview.app`.

`sign-manifest` is a development fixture tool. Release CI must sign generated manifests using a protected signing secret, not a command-line seed.

The checked-in fixture can be exercised with:

```bash
SEED=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
mise exec -- zig build run -- sign-manifest fixtures/payload.json /tmp/library-manifest.signed "$SEED"
mise exec -- zig build run -- install /tmp/library-manifest.signed --root /tmp/library-install-test
```

The HTTPS downloader is compile-verified on Linux, Windows, and macOS targets. The CI download harness exercises redirects, retries, size rejection, checksum rejection, and cache promotion against a local HTTP server. HTTPS certificate-chain testing remains separate because Zig 0.16's standard client does not currently make a local test CA straightforward to inject; production downloads remain HTTPS-only by default, while `--allow-http` is an explicit test-only escape hatch.

GitHub Actions runs the download and Web Preview integration suites on Linux.
A native macOS runner executes the installer tests, builds the ReleaseSmall
binary, inspects it, and runs its command-line help. CI also verifies the
Windows x86_64, Intel macOS, and Apple Silicon macOS cross-builds. The
protected publish workflow builds small release binaries, signs the Web
Preview manifest from a repository secret, checks the pinned public key, and
attaches the results to the preview release.

The Linux host build is verified locally. The installer executable
cross-compiles for Windows x86_64, Intel macOS, and Apple Silicon macOS. The
native desktop payloads remain unsigned, unnotarized, and not release-certified
on Windows and macOS. The installer does not yet install Readest or Sioyek or
create a Windows Start Menu entry.

## No sudo required

The preview installer is designed for a normal user account. It does not call
`sudo`, `pkexec`, `doas`, a package manager, or a system service manager, and
it does not write to `/opt`, `/usr/local`, or another system directory.

Use a directory owned by the user, such as:

```bash
library-setup-linux-x86_64 install-url \
  https://github.com/Adjanour/library/releases/download/v0.1.1-preview.1/library-web-preview-manifest.signed \
  --root "${XDG_DATA_HOME:-$HOME/.local/share}/library-preview"
```

The `--root` flag is explicit so the installer never guesses where it may
write. Passing a system-owned directory would defeat the user-owned install
model and is intentionally not part of the supported preview flow.
