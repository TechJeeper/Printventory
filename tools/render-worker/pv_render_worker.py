#!/usr/bin/env python3
"""Printventory remote thumbnail render worker.

Offloads thumbnail rendering from a Printventory server (e.g. a small NAS) to another
machine. It only talks to Printventory over HTTP:

  1. MCP  `get_models_missing_thumbnails`  -> which models need a thumbnail
  2. GET  /api/file/<path>                 -> the model bytes (server mode file endpoint)
  3. Render locally: the embedded 3MF thumbnail if present, else `stl-thumb`
  4. MCP  `set_thumbnail`                   -> push the PNG back into the library

No shared mounts, SSH or database access are needed. Python 3.8+ stdlib only;
rendering needs `stl-thumb` (https://github.com/unlimitedbacon/stl-thumb) and a display,
so run under `xvfb-run -a` on a headless box.

Configuration (environment variables):
  PV_URL             Printventory base URL (default http://localhost:5000)
  PV_WORKERS         parallel renders (default: CPU count, max 8)
  PV_SIZE            thumbnail size in px (default 512)
  PV_MAX_MB          skip files larger than this (default 200)
  PV_BATCH           models requested per poll (default 200, MCP max 500)
  PV_IDLE_SECONDS    sleep when nothing is left to render (default 300)
  PV_STATE_DIR       where failed ids are remembered (default ~/.cache/pv-render-worker)
  PV_STL_THUMB       stl-thumb binary (default stl-thumb)
  PV_ONCE=1          exit after the queue is drained instead of polling forever
"""
import base64, concurrent.futures as cf, io, json, os, struct, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request, zipfile
import xml.etree.ElementTree as ET

PV_URL = os.environ.get("PV_URL", "http://localhost:5000").rstrip("/")
WORKERS = int(os.environ.get("PV_WORKERS", min(8, os.cpu_count() or 2)))
SIZE = int(os.environ.get("PV_SIZE", 512))
MAX_BYTES = float(os.environ.get("PV_MAX_MB", 200)) * 1024 * 1024
BATCH = min(500, int(os.environ.get("PV_BATCH", 200)))
IDLE = int(os.environ.get("PV_IDLE_SECONDS", 300))
STATE_DIR = os.path.expanduser(os.environ.get("PV_STATE_DIR", "~/.cache/pv-render-worker"))
STL_THUMB = os.environ.get("PV_STL_THUMB", "stl-thumb")
ONCE = os.environ.get("PV_ONCE") == "1"
RENDERABLE = {".stl", ".3mf", ".obj"}


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


class Mcp:
    """Minimal Streamable-HTTP MCP client (JSON responses, session header)."""

    def __init__(self, url):
        self.url, self.sid, self.n = url + "/mcp", None, 0

    def _post(self, payload):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if self.sid:
            h["Mcp-Session-Id"] = self.sid
        req = urllib.request.Request(self.url, json.dumps(payload).encode(), h)
        with urllib.request.urlopen(req, timeout=120) as r:
            self.sid = r.headers.get("Mcp-Session-Id") or self.sid
            body = r.read().decode()
        if body.startswith("event:") or body.startswith("data:"):  # SSE framing
            body = "".join(l[5:] for l in body.splitlines() if l.startswith("data:"))
        return json.loads(body) if body.strip() else None

    def connect(self):
        self.sid = None
        self._post({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "pv-render-worker", "version": "1.0"}}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def call(self, name, args):
        self.n += 1
        for attempt in (1, 2):
            try:
                res = self._post({"jsonrpc": "2.0", "id": self.n, "method": "tools/call",
                                  "params": {"name": name, "arguments": args}})
                if "error" in res:
                    raise RuntimeError(res["error"])
                text = res["result"]["content"][0]["text"]
                if res["result"].get("isError"):
                    raise RuntimeError(text)
                try:
                    return json.loads(text)
                except ValueError:
                    return text
            except Exception:
                if attempt == 2:
                    raise
                self.connect()  # session expired / server restarted


STATS = {"bytes": 0, "embedded": 0, "rendered": 0}


def fetch(path):
    url = PV_URL + "/api/file/" + urllib.parse.quote(path, safe="")
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    STATS["bytes"] += len(data)
    return data


def embedded_3mf_thumbnail(data):
    """Slicer-exported 3MFs carry a preview PNG; using it is instant and matches the slicer."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = {n.lower(): n for n in z.namelist()}
            for want in ("metadata/thumbnail.png", "metadata/plate_1.png", "auxiliaries/.thumbnails/thumbnail_middle.png"):
                if want in names:
                    png = z.read(names[want])
                    if png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 1000:
                        return png
    except zipfile.BadZipFile:
        pass
    return None


def _xf(t):
    """3MF transform string -> 3x4 matrix (row-vector convention)."""
    v = [float(x) for x in t.split()] if t else [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    return [v[0:3], v[3:6], v[6:9], v[9:12]]


def _mul(a, b):
    """Compose: apply a, then b."""
    r = [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    r.append([sum(a[3][k] * b[k][j] for k in range(3)) + b[3][j] for j in range(3)])
    return r


def threemf_to_stl(data, out_path):
    """Flatten a 3MF (all .model parts, components and build transforms) into a binary STL.

    stl-thumb's own 3MF reader fails on many slicer/CAD exports ("failed to fill whole
    buffer"); STL input is reliable, so every 3MF is rendered through this path.
    """
    z = zipfile.ZipFile(io.BytesIO(data))
    objs = {}  # (part, id) -> ("mesh", verts, tris) | ("comp", [(part, id, xf)])
    parts = [n for n in z.namelist() if n.lower().endswith(".model")]
    if not parts:
        raise RuntimeError("3MF has no model part")
    root_part = "/" + next((n for n in parts if n.lower() == "3d/3dmodel.model"), parts[0]).lstrip("/")
    for name in parts:
        part = "/" + name.lstrip("/")
        tree = ET.parse(z.open(name))
        for obj in tree.iter():
            if not obj.tag.endswith("}object"):
                continue
            oid = obj.get("id")
            mesh = next((c for c in obj if c.tag.endswith("}mesh")), None)
            if mesh is not None:
                verts, tris = [], []
                for el in mesh.iter():
                    if el.tag.endswith("}vertex"):
                        verts.append((float(el.get("x")), float(el.get("y")), float(el.get("z"))))
                    elif el.tag.endswith("}triangle"):
                        tris.append((int(el.get("v1")), int(el.get("v2")), int(el.get("v3"))))
                objs[(part, oid)] = ("mesh", verts, tris)
            else:
                comps = []
                for el in obj.iter():
                    if el.tag.endswith("}component"):
                        path = next((v for k, v in el.attrib.items() if k.endswith("path")), None)
                        comps.append((("/" + path.lstrip("/")) if path else part, el.get("objectid"), _xf(el.get("transform"))))
                objs[(part, oid)] = ("comp", comps)
    root = ET.parse(z.open(root_part.lstrip("/")))
    items = [(root_part, el.get("objectid"), _xf(el.get("transform"))) for el in root.iter() if el.tag.endswith("}item")]
    if not items:  # no build section: render every object in the root part
        items = [(p, o, _xf(None)) for (p, o) in objs if p == root_part]
    facets = []

    def emit(key, xf, depth=0):
        o = objs.get(key)
        if o is None or depth > 16:
            return
        if o[0] == "comp":
            for part, oid, cxf in o[1]:
                emit((part, oid), _mul(cxf, xf), depth + 1)
            return
        _, verts, tris = o
        tv = [(x * xf[0][0] + y * xf[1][0] + z_ * xf[2][0] + xf[3][0],
               x * xf[0][1] + y * xf[1][1] + z_ * xf[2][1] + xf[3][1],
               x * xf[0][2] + y * xf[1][2] + z_ * xf[2][2] + xf[3][2]) for x, y, z_ in verts]
        for a, b, c in tris:
            facets.append((tv[a], tv[b], tv[c]))

    for part, oid, xf in items:
        emit((part, oid), xf)
    if not facets:
        raise RuntimeError("3MF contains no triangles")
    with open(out_path, "wb") as f:
        f.write(b"pv-render-worker".ljust(80, b" "))
        f.write(struct.pack("<I", len(facets)))
        for a, b, c in facets:
            f.write(struct.pack("<12fH", 0, 0, 0, *a, *b, *c, 0))


def render(model):
    path = model["filePath"]
    ext = os.path.splitext(path)[1].lower()
    if ext not in RENDERABLE:
        return None, f"unsupported type {ext}"
    if (model.get("size") or 0) > MAX_BYTES:
        return None, "too large"
    data = fetch(path)
    if ext == ".3mf":
        png = embedded_3mf_thumbnail(data)
        if png:
            return png, "embedded"
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "out.png")
        if ext == ".3mf":
            src = os.path.join(td, "model.stl")
            threemf_to_stl(data, src)
        else:
            src = os.path.join(td, "model" + ext)
            with open(src, "wb") as f:
                f.write(data)
        p = subprocess.run([STL_THUMB, src, out, "-s", str(SIZE)], capture_output=True, timeout=600)
        if p.returncode != 0 or not os.path.exists(out):
            err = p.stderr.decode(errors="replace").strip().splitlines()
            return None, "stl-thumb: " + (err[-1] if err else f"exit {p.returncode}")
        with open(out, "rb") as f:
            return f.read(), "rendered"


def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    failed_file = os.path.join(STATE_DIR, "failed.json")
    failed = set(json.load(open(failed_file))) if os.path.exists(failed_file) else set()
    mcp = Mcp(PV_URL)
    while True:
        try:
            mcp.connect()
            break
        except Exception as e:
            log(f"waiting for {PV_URL}: {e}")
            time.sleep(30)
    log(f"worker up: {PV_URL} workers={WORKERS} size={SIZE} known-failed={len(failed)}")
    while True:
        try:
            batch = [m for m in mcp.call("get_models_missing_thumbnails", {"limit": BATCH}) if m["id"] not in failed]
        except Exception as e:  # server restarting (502) etc.
            log(f"queue poll failed, retrying in 60s: {e}")
            time.sleep(60)
            continue
        if not batch:
            if ONCE:
                log("queue drained")
                return
            time.sleep(IDLE)
            continue
        ok = transient = 0
        t0, b0 = time.time(), STATS["bytes"]
        with cf.ThreadPoolExecutor(WORKERS) as pool:
            futs = {pool.submit(render, m): m for m in batch}
            for fut in cf.as_completed(futs):
                m = futs[fut]
                try:
                    png, how = fut.result()
                    if png is None:
                        raise RuntimeError(how)
                    STATS[how] = STATS.get(how, 0) + 1
                    mcp.call("set_thumbnail", {"id": m["id"], "image": base64.b64encode(png).decode(), "mimeType": "image/png"})
                    ok += 1
                except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                    # Server restarting / share offline: not the model's fault, retry next poll.
                    transient += 1
                    log(f"RETRY id={m['id']} {m['filePath']}: {e}")
                except Exception as e:
                    failed.add(m["id"])
                    log(f"FAIL id={m['id']} {m['filePath']}: {e}")
        json.dump(sorted(failed), open(failed_file, "w"))
        dt = max(time.time() - t0, 0.001)
        log(f"batch done: {ok}/{len(batch)} thumbnails set, {transient} to retry, {len(failed)} known failures | "
            f"{ok / dt * 60:.0f} models/min, {(STATS['bytes'] - b0) / 1e6 / dt:.1f} MB/s fetched, "
            f"totals: {STATS['rendered']} rendered, {STATS['embedded']} embedded 3MF previews, {STATS['bytes'] / 1e9:.2f} GB")
        if transient and not ok:
            time.sleep(60)  # server or share is down; back off instead of hammering it


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
