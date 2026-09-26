# Changelog

All notable changes to Library are documented here.

## [0.1.1] - 2026-09-26

### Fixed

- Added a review/apply metadata repair pass that only changes removable title noise and reliable EPUB-date or arXiv year fallbacks.
- Added standards-aware EPUB cover fallback selection for books whose package metadata does not declare a cover.
- Tightened arXiv filename matching so unrelated numeric filenames are not treated as paper years.

### Validation

- Applied 76 high-confidence metadata repairs across the local library database.
- Rebuilt and reinstalled the Linux desktop bundle from the Deno flow.

## [0.1.0] - 2026-09-26

### Added

- Fast in-app EPUB and PDF reading with durable progress, automatic sessions, and a bounded cancellable EPUB cache.
- EPUB cover extraction with standards-aware fallback selection and a generated title preview when an EPUB has no usable image.
- Lightweight PDF first-page previews with range requests and a 120% default reader zoom.
- Command palette with `Ctrl/Cmd+K`, compact filter chips, card-level Continue actions, and stronger keyboard focus behavior.
- Reading queue actions, drag-to-reorder, completion promotion, skip confirmation, and a curated ten-book/paper starter queue.
- IBM Plex Sans UI typography and IBM Plex Serif reading typography.
- Automated cache, cover-selection, scanner, database, and progress/session tests.
- Review-only metadata repair script at `deno/scripts/review-metadata.ts` for title and year suggestions with provenance.

### Fixed

- EPUB reader startup is resilient to cancellation and retains at most two warmed books.
- EPUB/PDF progress updates are throttled and finish state is persisted at the end of a document.
- ArXiv identifiers are no longer interpreted as literal years; modern ArXiv IDs can provide a year fallback.
- Metadata cleanup removes zero-width formatting noise and known EPUB conversion suffixes without overwriting manual edits.
- PDF reader opens at a sensible 120% zoom instead of 196%.

### Validation

- Deno checks and tests pass: 37 tests.
- Svelte check passes with no errors; production frontend build passes.
- Go scanner year/title tests and database tests pass.
- The full Go suite retains one known machine-local first-page fixture mismatch for `2602.02734v2.pdf`; it was not changed as part of this release.
