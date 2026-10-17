# Remote thumbnail render worker

Renders Printventory thumbnails on another machine (e.g. a desktop with a GPU) so a small server/NAS does not have to. It only uses HTTP: MCP `get_models_missing_thumbnails` and `set_thumbnail`, plus `GET /api/file/<path>` for the model bytes. No shared mounts, SSH or database access.

## How it renders
- 3MF with an embedded slicer preview (`Metadata/thumbnail.png`, `Metadata/plate_1.png`, …): uses it as-is.
- STL / OBJ: [`stl-thumb`](https://github.com/unlimitedbacon/stl-thumb).
- Other 3MF: flattened to STL in pure Python (parts, components, build transforms), then `stl-thumb`. stl-thumb's own 3MF reader fails ("failed to fill whole buffer") on many standard 3MFs.
- Zip entries (`archive.zip::model.stl`) are not supported and are recorded as failures.

## Setup
1. Install Python 3.8+ (stdlib only), `stl-thumb` and `xvfb` (`xvfb-run`).
2. Copy `pv_render_worker.py` to e.g. `/opt/pv-render-worker/`.
3. Try it once: `PV_URL=http://server:5000 PV_ONCE=1 xvfb-run -a python3 pv_render_worker.py`
4. Run as a service: edit `User`, `PV_URL` and the path in `pv-render-worker.service`, copy it to `/etc/systemd/system/`, then `sudo systemctl daemon-reload && sudo systemctl enable --now pv-render-worker`.

| Variable | Default | Meaning |
|---|---|---|
| `PV_URL` | `http://localhost:5000` | Printventory base URL |
| `PV_WORKERS` | CPU count, max 8 | parallel renders |
| `PV_SIZE` | 512 | thumbnail size (px) |
| `PV_MAX_MB` | 200 | skip larger files |
| `PV_BATCH` | 200 | models per poll (MCP max 500) |
| `PV_IDLE_SECONDS` | 300 | sleep when the queue is empty |
| `PV_STATE_DIR` | `~/.cache/pv-render-worker` | remembers failed model ids |
| `PV_STL_THUMB` | `stl-thumb` | binary path |
| `PV_ONCE=1` | off | exit when the queue is drained |

Progress: `journalctl -u pv-render-worker | grep "batch done"` (models/min, MB/s fetched, totals).

## Docker notes
The worker runs outside the Printventory container and needs the server-mode HTTP port reachable. Keep `PV_WORKERS` low (2) when the server reads models from a slow share: throughput is bound by the server serving files, not by rendering. Leave browser tabs on the app closed during a large initial run.

## Measured (≈4.8k-model library, server on a 4-core NAS reading an SMB share)
z370 worker, 12 cores, GTX 1660, 512 px, 0.25–0.4 s per render: 8 workers ≈60 models/min; 2 workers 29–118 models/min (≈1.2–3 MB/s fetched), 1,400 thumbnails in ≈22 min, ≈13% from embedded 3MF previews.

## Known gaps
- `get_models_missing_thumbnails` has no `offset`/`excludeIds`. Models that can never render stay at the head of the queue; once a batch is all known failures the worker cannot reach the rest. Proposal: add `offset` (or `excludeIds`).
- `/api/file` should be restricted to library paths; this worker only requests model paths from the library, so it keeps working once it is.
