# Changelog

All notable changes contributed via pull request are documented in this file.

## [Unreleased]

## [2.1.14] - 2026-07-25

### Fixed

- Fixed failed thumbnail regeneration

### Changed

- Prepare for 2.2 Public Release

## [2.1.13] - 2026-07-22

### Fixed

- Faster cold start: bundle column migration no longer rewrites every non-ZIP model on each launch (one-shot zip-only backfill), and extract-temp cleanup no longer blocks window creation or readdir’s the full OS TEMP folder at startup.

## [2.1.12] - 2026-07-21

### Fixed

- Fixed thumbnail generation for models inside ZIP archives: `get-file-stats` now reads entry size from the archive instead of `fs.stat` on the virtual `zip::` path (which caused ENOENT and left archive STLs on the default `3d.png` placeholder).

## [2.1.11] - 2026-07-21

### Fixed

- Fixed issue where directories were being grouped. Bundle grouping is limited to ZIP archives (and `parentModel` metadata groups); plain folder siblings stay as individual models. Legacy `folder:` bundle keys are cleared on startup.

## [2.1.10] - 2026-07-21

### Fixed

- Folder/ZIP group cards no longer aggregate every child thumbnail into a runaway `1/539`-style carousel; carousel is capped (12), uses one primary image per part, and hydrates without per-child badge updates or `getAllThumbnails` storms (also speeds up startup on large libraries).
- Bundle group card meta text no longer appends the long “right-click Preview” hint inline; overflow is clipped cleanly in list/detailed/preview layouts.
- Bundle details sidebar spacing no longer inherits the blanket `.model-details div` margin on every nested element.
- Folder/ZIP group **icons** no longer stay stuck on the generic `3d.png` placeholder: grid rows omit thumbnail blobs, so groups now prioritize `hasThumbnail` children, fetch the first wave in parallel, and cache results across virtual-grid recycles (fixes blank zip/folder icons and reduces long startup churn).
- Large flat STLs (e.g. ~400mm plates) no longer save blank/transparent grid thumbnails: thumbnail camera far plane now matches preview, framing centers after orientation, and clipped empty thumbs are detected and regenerated.
- Docker image now includes `bundle-keys.js` (required for folder/ZIP bundle grouping in server mode).

## [2.1.9] - 2026-07-19

### Fixed

- ZIP model extracts now always land under the OS temp folder (`printventory-extracts/`), never beside library files, and are cleaned up after preview/read, slicer launch, open, download, app quit, and on startup.

## [2.1.8] - 2026-07-19

### Added

- **Folder and ZIP bundle grouping** — When scanning, models that share the same parent folder or the same ZIP archive (2+ files) are grouped into a single row in List, Preview, and Detailed views. Single-file folders stay as individual entries.
- **Bundle 3D preview** — Click a folder or ZIP bundle to open one preview dialog showing every STL/3MF part laid out on a grid, with per-part colors for clarity. Up to 32 previewable parts per bundle.
- **Bundle details panel** — Double-click a bundle (or use **Open 3D preview** from the panel) to see path, combined size, print status, and a sortable file list. Chevron still expands/collapses the bundle in the grid.
- **Send to Slicer in preview** — The 3D preview dialog includes a **Send to Slicer** button. Works for single models and full bundles (all STL/3MF paths). If multiple slicers are configured, a picker is shown.
- **New slicer instance on send** — macOS launches slicers with `open -n` so a new window opens even when the slicer is already running. Prusa-family binaries also receive `--single-instance=0` when launched directly.
- **`bundle-keys.js`** — Shared logic to derive `bundleKey`, `bundleLabel`, and `bundleKind` from file paths (including `zipPath::entry` paths).
- **`npm run test:bundle`** — Unit tests for bundle key derivation.

### Changed

- Scan insert/update and `saveModel` persist bundle metadata (`bundleKey`, `bundleLabel`, `bundleKind`) with automatic migration on startup.
- Context menu **Open in Slicer** and preview **Send to Slicer** share the same launch helper (`buildSlicerLaunchCommand` / `open-file-in-slicer` IPC).
- `window.openSlicerSettings` is exposed from `slicer.js` for use from the preview flow.

### Database

- New optional columns on `models`: `bundleKey`, `bundleLabel`, `bundleKind` (backfilled on existing databases).
