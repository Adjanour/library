# Library Web Preview

The Web Preview is the local browser version of Library. It serves the
production Svelte interface from the Deno API, so books remain on the tester's
machine and the application can scan local folders, read files, and persist
state in SQLite.

## Install the preview

Download the small setup program for your machine from the
[Library preview release](https://github.com/Adjanour/library/releases/tag/v0.1.1-preview.1):

- `library-setup-windows-x86_64.exe` for 64-bit Windows
- `library-web-setup-macos-aarch64.zip` for Apple Silicon Macs
- `library-web-setup-macos-x86_64.zip` for Intel Macs
- `library-web-setup-linux-x86_64.tar.gz` for 64-bit Linux

Run the downloaded setup program without arguments. It chooses a user-owned
install folder, downloads the signed Web Preview manifest, installs a private
Deno 2.9.6 runtime, verifies every download, caches the locked dependencies,
creates a launcher, and opens Library at <http://localhost:8080>.

No account, separate Deno installation, administrator access, or `sudo` is
required. The installer is small; the verified Deno and Library payloads add
about 45 MB during setup.

### Windows

Double-click `library-setup-windows-x86_64.exe`, or run it from PowerShell:

```powershell
.\library-setup-windows-x86_64.exe
```

The files are installed under `%LOCALAPPDATA%\Library Preview`. The reusable
launcher is:

```bat
%LOCALAPPDATA%\Library Preview\web-preview\bin\library-web-preview.cmd
```

This preview binary is not code-signed yet, so Windows SmartScreen may display
a warning. Do not treat the build as release-certified until Windows signing
and native-device verification are complete.

### macOS

Choose the ZIP matching the Mac processor. Open it, then double-click
`Install Library Web Preview.command`. The terminal shows each verified setup
stage and remains open while Library is running.

Setup installs a reusable app at:

```bash
~/Applications/Library Web Preview.app
```

Library's runtime and data remain under
`~/Library/Application Support/Library Preview`.

The preview installer is not notarized yet. macOS may quarantine it, so these
builds remain for developer testing rather than general distribution. If
Gatekeeper blocks the command, right-click it, choose **Open**, and confirm the
prompt. Do not disable Gatekeeper globally.

### Linux

```bash
tar -xzf library-web-setup-linux-x86_64.tar.gz
cd library-web-preview-setup
./install-library-web-preview
```

Library is installed under `$XDG_DATA_HOME/library-preview` or
`~/.local/share/library-preview`. Setup also adds Library to the current
user's application menu.

### Custom install folder or installation only

Use `--root` with an absolute path to override the platform default. Add
`--no-launch` when setup should install the files without starting Library.
Use `--no-shortcuts` to skip the macOS app or Linux application-menu entry:

```bash
./library-setup-linux-x86_64 web-preview --root /absolute/path --no-launch --no-shortcuts
```

## Manual bundle fallback

The release still includes `library-web-v0.1.1-preview.1.zip` and
`library-web-v0.1.1-preview.1.tar.gz` for contributors who want to inspect or
run the files manually. The manual archives require Deno 2.9.6 or newer on
`PATH`; the setup programs do not.

The installed launcher accepts `LIBRARY_PORT` when port 8080 is unavailable.

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
