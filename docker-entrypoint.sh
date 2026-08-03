#!/bin/bash
set -e

# Function to handle shutdown
cleanup() {
    echo "Shutting down..."
    kill -TERM "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Clean up any stale X11 lock files
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

# Start Xvfb (X Virtual Framebuffer) for headless display
echo "Starting Xvfb..."
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb to be ready
sleep 2

# Verify Xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "Error: Failed to start Xvfb"
    exit 1
fi

echo "Xvfb started successfully (PID: $XVFB_PID)"

# Set DISPLAY environment variable
export DISPLAY=:99

# Disable dconf to prevent warnings in headless Docker environment
export DCONF_DISABLE=1
export GIO_USE_VFS=local
export GIO_USE_VOLUME_MONITOR=unix
# Chromium treats missing/invalid DBUS as ERROR spam; provide private buses.
export DBUS_FATAL_WARNINGS=0

# Start a private D-Bus session bus (containers have no system/session bus by default).
mkdir -p /tmp/dbus
rm -f /tmp/dbus/bus
if command -v dbus-daemon >/dev/null 2>&1; then
  DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address --address=unix:path=/tmp/dbus/bus 2>/dev/null) || true
  if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    export DBUS_SESSION_BUS_ADDRESS
    echo "D-Bus session started at $DBUS_SESSION_BUS_ADDRESS"
  else
    unset DBUS_SESSION_BUS_ADDRESS
    echo "Warning: dbus-daemon (session) failed to start"
  fi

  # Chromium also probes the *system* bus (/run/dbus/system_bus_socket). Without it,
  # Electron logs ERROR:dbus/bus.cc which looks like app failures to Docker users.
  mkdir -p /run/dbus
  if [ ! -S /run/dbus/system_bus_socket ]; then
    if dbus-daemon --system --fork --nopidfile --address=unix:path=/run/dbus/system_bus_socket 2>/dev/null; then
      export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"
      echo "D-Bus system bus started at $DBUS_SYSTEM_BUS_ADDRESS"
    else
      # Fallback: point system address at the session socket so connect() succeeds.
      if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
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

# Drop Chromium noise that looks like app failures in Docker logs.
# - dbus: headless containers have no real session/system bus
# - gpu SharedImage / Skia OOM recovery: GPU process restart storms (esp. NVIDIA+ANGLE)
# Keep real app/console errors; only filter known Chromium internal paths.
filter_electron_stderr() {
  grep -v --line-buffered -E \
    'ERROR:dbus/|Failed to connect to the bus:|Failed to connect to socket /run/dbus/|ERROR:gpu/|ERROR:components/viz/service/gl/|Restarting GPU process due to unrecoverable error|SharedContextState context lost|CreateSharedImage: could not create backing|SharedImageStub: Unable to create shared image|GPU state invalid after WaitForGetOffsetInRange' \
    || true
}

# Ensure config directory exists with proper permissions
mkdir -p /root/.config/Printventory
chmod -R 755 /root/.config/Printventory

# Start Electron in server mode
echo "Starting Printventory server mode..."
echo "DISPLAY is set to: $DISPLAY"
echo "Working directory: $(pwd)"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"

# GPU backend selection for the hidden Electron thumbnail worker.
# Default: auto — use NVIDIA when the toolkit exposes a device; otherwise SwiftShader.
# Override with PRINTVENTORY_GPU=swiftshader|nvidia|auto
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
    if [ -n "$NVIDIA_HINT" ] || { [ -n "${NVIDIA_VISIBLE_DEVICES:-}" ] && [ "${NVIDIA_VISIBLE_DEVICES}" != "void" ]; }; then
      if [ -n "$NVIDIA_HINT" ]; then
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

# graphics libs are required for WebGL — compute/utility alone is not enough
if [ "$USE_NVIDIA" = "1" ]; then
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

ELECTRON_GPU_ARGS=()
# Headless thumbnails need WebGL, not GPU compositing of the (hidden) UI.
# Compositor SharedImages are a common source of Skia OOM / CreateSharedImage spam.
ELECTRON_GPU_ARGS+=(--disable-gpu-compositing)

if [ "$USE_NVIDIA" = "1" ]; then
  export PRINTVENTORY_GL_BACKEND=nvidia
  # ANGLE backend: vulkan (default, best nvidia-container-toolkit WebGL) | gl | egl
  ANGLE_BACKEND="$(echo "${PRINTVENTORY_ANGLE:-vulkan}" | tr '[:upper:]' '[:lower:]')"
  echo "GPU backend: NVIDIA hardware WebGL (PRINTVENTORY_GPU=${GPU_MODE}, PRINTVENTORY_ANGLE=${ANGLE_BACKEND})"
  if [ -n "$NVIDIA_HINT" ]; then
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
      # ANGLE+Vulkan is the practical path for Chromium/Electron inside nvidia-container-toolkit.
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

# Run Electron in the foreground to see output and keep container alive
# --no-sandbox: allow running as root in Docker
# V8 heap: default was a hard 3072MB (tuned for 4g containers). On large hosts that
# still OOMs ("Zone Allocation failed") even with 64–96GB free. Scale from cgroup
# memory limit when present, or PRINTVENTORY_MAX_OLD_SPACE_MB.
# expose-gc lets thumbnail cleanup call gc().
resolve_max_old_space_mb() {
  if [ -n "${PRINTVENTORY_MAX_OLD_SPACE_MB:-}" ]; then
    echo "${PRINTVENTORY_MAX_OLD_SPACE_MB}"
    return
  fi

  local limit_bytes=""
  if [ -r /sys/fs/cgroup/memory.max ]; then
    limit_bytes="$(cat /sys/fs/cgroup/memory.max 2>/dev/null || true)"
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    limit_bytes="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || true)"
  fi

  # No cgroup limit (or "max") — allow a larger heap on big Docker hosts.
  if [ -z "$limit_bytes" ] || [ "$limit_bytes" = "max" ] || [ "$limit_bytes" -gt 1000000000000 ] 2>/dev/null; then
    echo 8192
    return
  fi

  # Use ~60% of the container limit, clamped 2048–16384 MiB; leave room for
  # Electron/GPU native buffers outside the V8 old space.
  local limit_mb=$((limit_bytes / 1024 / 1024))
  local heap_mb=$((limit_mb * 60 / 100))
  if [ "$heap_mb" -lt 2048 ]; then
    heap_mb=2048
  elif [ "$heap_mb" -gt 16384 ]; then
    heap_mb=16384
  fi
  echo "$heap_mb"
}

MAX_OLD_SPACE_MB="$(resolve_max_old_space_mb)"
echo "V8 max-old-space-size: ${MAX_OLD_SPACE_MB}MB (override with PRINTVENTORY_MAX_OLD_SPACE_MB)"

# The --server flag is passed via CMD in Dockerfile.
# Filter Chromium dbus probe failures from stderr so Docker users are not confused.
exec npx electron . \
  --no-sandbox \
  "${ELECTRON_GPU_ARGS[@]}" \
  --disable-dev-shm-usage \
  --js-flags="--max-old-space-size=${MAX_OLD_SPACE_MB} --expose-gc" \
  --server \
  2> >(filter_electron_stderr >&2)
