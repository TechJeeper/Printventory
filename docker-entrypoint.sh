#!/bin/bash
# Docker entrypoint — delegates to the shared headless server runner.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# In the image, this file lives at /usr/local/bin/docker-entrypoint.sh;
# the app is at /app. Prefer WORKDIR /app when present.
if [[ -f /app/scripts/run-server.sh ]]; then
  APP_ROOT=/app
elif [[ -f "${APP_ROOT}/scripts/run-server.sh" ]]; then
  :
elif [[ -f "${APP_ROOT}/../scripts/run-server.sh" ]]; then
  APP_ROOT="$(cd "${APP_ROOT}/.." && pwd)"
fi

exec "${APP_ROOT}/scripts/run-server.sh" "$@"
