# Preview testing guide

This guide is for friends testing Library on their own machines. The goal is
to find platform-specific problems before the first certified `v0.1.1` release.

## Download the current preview

The public preview page is:

<https://github.com/Adjanour/library/releases/tag/v0.1.1-preview.1>

The published Linux installer is experimental. It installs into a directory
owned by the current user and does not require `sudo`:

```bash
curl -L -o library-setup-linux-x86_64 \
  https://github.com/Adjanour/library/releases/download/v0.1.1-preview.1/library-setup-linux-x86_64
chmod +x library-setup-linux-x86_64
./library-setup-linux-x86_64 install-url \
  https://github.com/Adjanour/library/releases/download/v0.1.1-preview.1/library-preview-manifest.signed \
  --root "${XDG_DATA_HOME:-$HOME/.local/share}/library-preview"
"${XDG_DATA_HOME:-$HOME/.local/share}/library-preview/library/bin/library"
```

Windows and macOS builds currently run in CI but are not published as signed
installers. Native testers should contact the project owner for the matching
build, or help validate a local build using
[`docs/getting-started.md`](getting-started.md).

## Test this first

Use a small folder containing at least one PDF and one EPUB. Do not use your
only copy of an important book while testing.

1. Launch Library and confirm that it opens without administrator access.
2. Open Settings and add the test folder as a scan directory.
3. Save and rescan. Confirm that the folder remains after restarting Library.
4. Check that titles, authors, years, covers, and file types look reasonable.
5. Open a PDF. Check the preview, page navigation, search, and 120% default zoom.
6. Open an EPUB. Check that the first page renders, contents opens, and next or
   previous page navigation works.
7. Change a reading preference, close the reader, reopen the book, and confirm
   the preference and reading position remain.
8. Try search, filters, the command palette, and the visible keyboard shortcuts.
9. Add a book to the queue, reorder it if available, and confirm that removing
   or skipping asks for confirmation.
10. Close and reopen Library. Confirm that progress, settings, and the queue
    are still correct.

## What to report

Please send:

- operating system and version
- machine architecture, such as x86_64 or Apple Silicon
- whether you used the release build or a local build
- the exact steps that led to the problem
- what you expected and what happened instead
- a screenshot or short screen recording when useful
- the book type and approximate file size, but not the book itself unless
  sharing it is permitted

For an EPUB failure, include the reader error text and whether the same file
opens in a normal browser. For a PDF failure, include the page number and zoom
level.

## Test result template

```text
OS:
Machine:
Build:

Passed:
-

Failed:
-

Steps to reproduce:
1.
2.
3.

Expected:
Actual:
Screenshot or recording:
```

## Current boundaries

Linux is the verified desktop target. Windows and macOS are build-capable but
still need native-device EPUB verification, signing, notarization, and
installer metadata before they can be called certified releases.
