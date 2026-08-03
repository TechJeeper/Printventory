"""Upload dist bundles using credentials from .scp (host/user/password/path)."""
from pathlib import Path
import sys
import paramiko

cfg = {}
for line in Path(".scp").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or ":" not in line:
        continue
    k, v = line.split(":", 1)
    cfg[k.strip().lower()] = v.strip()

host = cfg.get("host") or cfg.get("hostname")
user = cfg.get("user") or cfg.get("username")
password = cfg.get("password") or cfg.get("pass")
port = int(cfg.get("port") or 22)
remote_dir = cfg.get("path") or cfg.get("remote") or cfg.get("remotedir") or "."

files = [Path(p) for p in sys.argv[1:]] or [
    Path("dist/Printventory-Setup-2.1.18.exe"),
    Path("dist/printventory-2.1.18.AppImage"),
    Path("dist/printventory-2.1.18-universal.dmg"),
]

for f in files:
    if not f.exists() or f.stat().st_size <= 0:
        raise SystemExit(f"Missing or empty artifact: {f}")

transport = paramiko.Transport((host, port))
transport.connect(username=user, password=password)
sftp = paramiko.SFTPClient.from_transport(transport)
try:
    try:
        sftp.chdir(remote_dir)
    except IOError as exc:
        raise SystemExit(f"Remote path not found: {remote_dir}") from exc
    for f in files:
        print(f"Uploading {f.name} ({f.stat().st_size} bytes)...")
        sftp.put(str(f), f.name)
        print(f"Uploaded {f.name}")
finally:
    sftp.close()
    transport.close()
print("SCP upload complete")
