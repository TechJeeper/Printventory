#!/usr/bin/env bash
# Headless Printventory server mode (Docker entrypoint + systemd / Proxmox LXC).
# Run from the app root (directory that contains package.json and main.js).
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

cleanup() {
  echo "Shutting down..."
  if [[ -n "${XVFB_PID:-}" ]]; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
  exit 0
}

trap cleanup SIGTERM SIGINT

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

echo "Starting Xvfb..."
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

sleep 2

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "Error: Failed to start Xvfb"
  exit 1
fi

echo "Xvfb started successfully (PID: $XVFB_PID)"

export DISPLAY=:99
export DCONF_DISABLE=1
export GIO_USE_VFS=local
export GIO_USE_VOLUME_MONITOR=unix
export DBUS_FATAL_WARNINGS=0

mkdir -p /tmp/dbus
rm -f /tmp/dbus/bus
if command -v dbus-daemon >/dev/null 2>&1; then
  DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address --address=unix:path=/tmp/dbus/bus 2>/dev/null) || true
  if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
    export DBUS_SESSION_BUS_ADDRESS
    echo "D-Bus session started at $DBUS_SESSION_BUS_ADDRESS"
  else
    unset DBUS_SESSION_BUS_ADDRESS
    echo "Warning: dbus-daemon (session) failed to start"
  fi

  mkdir -p /run/dbus
  if [[ ! -S /run/dbus/system_bus_socket ]]; then
    if dbus-daemon --system --fork --nopidfile --address=unix:path=/run/dbus/system_bus_socket 2>/dev/null; then
      export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"
      echo "D-Bus system bus started at $DBUS_SYSTEM_BUS_ADDRESS"
    else
      if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        export DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"
        echo "D-Bus system bus unavailable; aliasing system address to session bus"
      fi
    fi
  else
    export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"
  fi
else
  unset DBUS_SESSION_BUS_ADDRESS
  unset DBUS_SYSTEM_BUS_ADDRESS
fi

filter_electron_stderr() {
  grep -v --line-buffered -E \
    'ERROR:dbus/|Failed to connect to the bus:|Failed to connect to socket /run/dbus/|ERROR:gpu/|ERROR:components/viz/service/gl/|Restarting GPU process due to unrecoverable error|SharedContextState context lost|CreateSharedImage: could not create backing|SharedImageStub: Unable to create shared image|GPU state invalid after WaitForGetOffsetInRange' \
    || true
}

CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME:-/root}/.config}"
mkdir -p "${CONFIG_HOME}/printventory"
chmod -R 755 "${CONFIG_HOME}/printventory"

echo "Starting Printventory server mode..."
echo "DISPLAY is set to: $DISPLAY"
echo "Working directory: $(pwd)"
echo "Node version: $(node --version 2>/dev/null || echo unknown)"
echo "NPM version: $(npm --version 2>/dev/null || echo unknown)"

GPU_MODE="$(echo "${PRINTVENTORY_GPU:-auto}" | tr '[:upper:]' '[:lower:]')"
USE_NVIDIA=0
NVIDIA_HINT=""

if command -v nvidia-smi >/dev/null 2>&1; then
  if nvidia-smi -L >/dev/null 2>&1; then
    NVIDIA_HINT="$(nvidia-smi -L 2>/dev/null | head -n 1 || true)"
  fi
fi

case "$GPU_MODE" in
  nvidia|hardware|gpu)
    USE_NVIDIA=1
    ;;
  swiftshader|software|cpu)
    USE_NVIDIA=0
    ;;
  auto|*)
    if [[ -n "$NVIDIA_HINT" ]] || { [[ -n "${NVIDIA_VISIBLE_DEVICES:-}" ]] && [[ "${NVIDIA_VISIBLE_DEVICES}" != "void" ]]; }; then
      if [[ -n "$NVIDIA_HINT" ]]; then
        USE_NVIDIA=1
      else
        echo "Warning: NVIDIA_VISIBLE_DEVICES is set but nvidia-smi found no GPU; falling back to SwiftShader"
        USE_NVIDIA=0
      fi
    else
      USE_NVIDIA=0
    fi
    ;;
esac

if [[ "$USE_NVIDIA" = "1" ]]; then
  CAPS="${NVIDIA_DRIVER_CAPABILITIES:-}"
  case ",${CAPS}," in
    *,graphics,*|*,all,*)
      ;;
    *)
      echo "Warning: NVIDIA_DRIVER_CAPABILITIES='${CAPS:-<unset>}' — WebGL needs 'graphics' (e.g. graphics,compute,utility)."
      echo "         Continuing with NVIDIA flags; if thumbnails stay on SwiftShader, fix capabilities and recreate the container."
      ;;
  esac
fi

ELECTRON_GPU_ARGS=(--disable-gpu-compositing)

if [[ "$USE_NVIDIA" = "1" ]]; then
  export PRINTVENTORY_GL_BACKEND=nvidia
  ANGLE_BACKEND="$(echo "${PRINTVENTORY_ANGLE:-vulkan}" | tr '[:upper:]' '[:lower:]')"
  echo "GPU backend: NVIDIA hardware WebGL (PRINTVENTORY_GPU=${GPU_MODE}, PRINTVENTORY_ANGLE=${ANGLE_BACKEND})"
  if [[ -n "$NVIDIA_HINT" ]]; then
    echo "  Detected: $NVIDIA_HINT"
  fi
  case "$ANGLE_BACKEND" in
    gl|opengl)
      ELECTRON_GPU_ARGS+=(
        --use-gl=angle
        --use-angle=gl
        --ignore-gpu-blocklist
        --enable-webgl
        --disable-gpu-sandbox
      )
      ;;
    egl)
      ELECTRON_GPU_ARGS+=(
        --use-gl=egl
        --ignore-gpu-blocklist
        --enable-webgl
        --disable-gpu-sandbox
      )
      ;;
    vulkan|*)
      ELECTRON_GPU_ARGS+=(
        --use-gl=angle
        --use-angle=vulkan
        --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE
        --disable-vulkan-surface
        --ignore-gpu-blocklist
        --enable-webgl
        --disable-gpu-sandbox
      )
      ;;
  esac
else
  export PRINTVENTORY_GL_BACKEND=swiftshader
  echo "GPU backend: SwiftShader software WebGL (PRINTVENTORY_GPU=${GPU_MODE})"
  ELECTRON_GPU_ARGS+=(
    --use-gl=angle
    --use-angle=swiftshader
    --ignore-gpu-blocklist
  )
fi

resolve_max_old_space_mb() {
  if [[ -n "${PRINTVENTORY_MAX_OLD_SPACE_MB:-}" ]]; then
    echo "${PRINTVENTORY_MAX_OLD_SPACE_MB}"
    return
  fi

  local limit_bytes=""
  if [[ -r /sys/fs/cgroup/memory.max ]]; then
    limit_bytes="$(cat /sys/fs/cgroup/memory.max 2>/dev/null || true)"
  elif [[ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]]; then
    limit_bytes="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || true)"
  fi

  if [[ -z "$limit_bytes" ]] || [[ "$limit_bytes" = "max" ]] || [[ "$limit_bytes" -gt 1000000000000 ]] 2>/dev/null; then
    echo 8192
    return
  fi

  local limit_mb=$((limit_bytes / 1024 / 1024))
  local heap_mb=$((limit_mb * 60 / 100))
  if [[ "$heap_mb" -lt 2048 ]]; then
    heap_mb=2048
  elif [[ "$heap_mb" -gt 16384 ]]; then
    heap_mb=16384
  fi
  echo "$heap_mb"
}

MAX_OLD_SPACE_MB="$(resolve_max_old_space_mb)"
echo "V8 max-old-space-size: ${MAX_OLD_SPACE_MB}MB (override with PRINTVENTORY_MAX_OLD_SPACE_MB)"

ELECTRON_BIN="${APP_ROOT}/node_modules/.bin/electron"
if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Error: Electron binary not found at $ELECTRON_BIN"
  exit 1
fi

# --no-sandbox: allow running as root (Docker / typical LXC).
# Filter Chromium dbus/gpu probe noise from stderr.
exec "$ELECTRON_BIN" . \
  --no-sandbox \
  "${ELECTRON_GPU_ARGS[@]}" \
  --disable-dev-shm-usage \
  --js-flags="--max-old-space-size=${MAX_OLD_SPACE_MB} --expose-gc" \
  --server \
  2> >(filter_electron_stderr >&2)
