# Changelog

All notable changes contributed via pull request are documented in this file.

## [Unreleased]

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
