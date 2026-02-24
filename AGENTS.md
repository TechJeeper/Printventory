# Agents

## Cursor Cloud specific instructions

### Overview

Printventory is a single-service Electron desktop app for managing 3D printing model collections (STL/3MF files). It can also run in **server mode** as a web app on port 5000. There is no external database — it uses embedded SQLite via `better-sqlite3`. No linting configuration exists in the project.

### Running the app

- **Desktop mode (Electron):** `DISPLAY=:99 npx electron . --no-sandbox` (requires Xvfb running)
- **Server mode (web):** `DISPLAY=:99 npx electron . --no-sandbox --server` — serves web UI on `http://localhost:5000`
- Xvfb must be running before launching Electron: `Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &`
- The `--no-sandbox` flag is required when running as root or in containers.
- dbus errors in logs are cosmetic and do not affect functionality.

### Testing

- **E2E tests:** `DISPLAY=:99 npx playwright test` (uses Playwright with Electron, not a browser)
- The single test in `verify.spec.js` launches the app, accepts the EULA, and verifies the main screen loads.
- Playwright browsers are not needed for the E2E test since it tests Electron directly, but `npx playwright install-deps` must have been run for system libraries.

### Key development notes

- `npm install` triggers a `postinstall` hook that runs `electron-builder install-app-deps` to rebuild native modules (e.g., `better-sqlite3`) for Electron's Node.js version.
- The app creates `printventory.db` in the working directory (dev mode) or user data dir (packaged). Delete it for a fresh state.
- Puppeteer is used for 3D model thumbnail generation. In this environment, Google Chrome is available at `/usr/bin/google-chrome-stable` — set `PUPPETEER_EXECUTABLE_PATH` if Puppeteer's bundled Chromium has issues.
- See `README.md` for full documentation on building, Docker deployment, and server mode configuration.
