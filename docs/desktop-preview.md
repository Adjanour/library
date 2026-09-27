# Library Desktop Preview

The Desktop Preview is the native CEF build of Library. It includes the
reader engine needed for the packaged EPUB experience and runs locally on the
tester’s machine.

## Install

Download the package for the machine:

- Windows x86_64: `library-setup-windows-x86_64.exe`
- macOS Apple Silicon: `library-setup-macos-aarch64.zip`
- macOS Intel: `library-setup-macos-x86_64.zip`
- Linux x86_64: `library-setup-linux-x86_64.tar.gz`

The small setup program detects the current operating system and architecture,
fetches the matching signed desktop bundle, verifies its SHA-256 digest, and
installs it below a user-owned application-data directory. It creates a
launcher and does not require Deno, administrator access, or `sudo`.

The native desktop bundle is larger than the setup program because it includes
Deno Desktop and CEF. The setup program downloads only the matching platform
bundle.

### Windows

Double-click the `.exe`, or run it from PowerShell:

```powershell
.\library-setup-windows-x86_64.exe
```

The launcher is installed below `%LOCALAPPDATA%\Library`.

### macOS

Choose the ZIP matching the Mac processor. Open it and double-click
`Install Library.command`. The app shortcut is created at:

```text
~/Applications/Library.app
```

Unsigned preview binaries may trigger Gatekeeper. If macOS blocks the command,
right-click it, choose **Open**, and confirm the prompt. Do not disable
Gatekeeper globally.

### Linux

```bash
tar -xzf library-setup-linux-x86_64.tar.gz
cd library-setup-linux
./install-library
```

The launcher is installed below `$XDG_DATA_HOME/library` or
`~/.local/share/library`, and a user-owned application-menu entry is created.

## Explicit Web Preview

The browser-only version remains available when a smaller application payload
is more useful:

```bash
./library-setup-linux-x86_64 web-preview
```

On macOS, use `Install Library Web Preview.command`. On Windows, run the setup
binary from PowerShell with the `web-preview` argument. This path installs a
private Deno runtime and opens Library in the browser.

## Current certification boundary

Linux is the currently verified native desktop target. Windows and macOS are
build-capable preview targets and still need native-device EPUB verification,
code signing, notarization, and final installer metadata.
