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

# Start Electron in server mode
echo "Starting Printventory server mode..."
echo "DISPLAY is set to: $DISPLAY"
echo "Working directory: $(pwd)"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"

# Run Electron in the foreground to see output and keep container alive
# Add --no-sandbox flag to allow running as root in Docker
# The --server flag is passed via CMD in Dockerfile
exec npx electron . --no-sandbox --server

