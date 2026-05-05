# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                     # run all tests (node:test, no external deps)
npm run lint                 # ESLint
node interactive-login.js    # start the control panel (port 7080)
node epic-games.js           # run a single claimer script directly
npm run docker               # pull & run the Docker image locally
npm run docker:build         # build the Docker image
```

Run a single test file: `node --test test/util.test.js`

## Architecture

The project has two distinct layers:

**Claimer scripts** (`epic-games.js`, `gog.js`, `prime-gaming.js`, `steam.js`, `aliexpress.js`, `microsoft.js`, `unrealengine.js`, `ubisoft.js`) — each script launches a Chromium browser via `patchright` (a Playwright fork with fingerprint injection), authenticates with saved session cookies, and claims free games/points. They share utilities from `src/util.js` and read configuration from `src/config.js`.

**Control panel** (`interactive-login.js`) — a Node.js HTTP server (no framework, no frontend build step) serving a multi-tab browser UI at port 7080. It orchestrates:
- Scheduling (runs claimer scripts as child processes via `runAllScripts`)
- Session status checks per service (`src/panel/sessions.js`)
- Claim history / library view (`src/panel/library.js`)
- Circuit breaker for failed runs (`src/panel/circuit-breaker.js`)
- Multi-account management (`src/panel/accounts.js`)
- Settings (written to `data/config.json`)
- Login flow UI (served to the VNC browser at port 6080 via noVNC in Docker)

**Data layer** — `lowdb` JSONFilePreset files under `data/` (one per service, e.g. `data/epic-games.json`). Accounts stored in `data/accounts.json`. App-level settings in `data/config.json`. Credentials loaded from `data/config.env` via `dotenv` (lowest precedence — env vars set before launch win).

### `src/panel/` modules

| File | Responsibility |
|------|---------------|
| `accounts.js` | CRUD for `data/accounts.json`; atomic write via temp-file rename; `maskAccountCredentials` |
| `sessions.js` | `SITES` map with `checkLogin(page)` per service; in-memory session cache (30 min / 5 min TTL) |
| `library.js` | `normalizeEntry` — maps raw lowdb records to unified library entries; `LIBRARY_STATUSES` set |
| `circuit-breaker.js` | CLOSED→OPEN→HALF-OPEN state machine; persisted to `data/circuit-breaker.json` |
| `html.js` | `LOGIN_HTML` and `PANEL_HTML` template literals (generated panel HTML) |

### Config precedence

`data/config.json` (Settings tab) → `process.env` / `data/config.env` → hardcoded defaults in `CONFIG_SCHEMA` (`src/app-config.js`). Credentials (passwords, OTP keys) are env-only and never appear in `data/config.json`.

### Key env vars

| Var | Purpose |
|-----|---------|
| `EMAIL` / `PASSWORD` | Shared fallback credentials for all services |
| `EG_EMAIL`, `GOG_EMAIL`, `STEAM_EMAIL`, … | Per-service credentials (override `EMAIL`) |
| `LOOP` | Scheduler interval in seconds (0 = disabled) |
| `BROWSER_DIR` | Override browser profile directory |
| `DEBUG=1` / `PWDEBUG=1` | Non-headless mode + Playwright Inspector |
| `DRYRUN=1` | Navigate but don't click claim buttons |
| `TG_TOKEN` + `TG_CHAT_ID` | Telegram notifications |
| `NOVNC_PORT` | Set by Docker entrypoint; enables noVNC integration |

## Key patterns

- **ESM throughout** — `"type": "module"` in package.json; all imports use `.js` extensions.
- **Lazy patchright import** — `launchBrowser` in `src/util.js` does `await import('patchright')` rather than a top-level import, so test files that import utilities don't require a browser binary.
- **Safe DOM in panel JS** — panel frontend code uses `textContent`, `createElement`, `appendChild`, `replaceChildren` — never `innerHTML`.
- **Atomic writes** — both `writeAccounts` and `writeAppConfig` write to a `.pid.tmp` file then `renameSync` to the final path.
- **Tests use `node:test`** — zero extra dependencies; run with `node --test`; isolate file I/O with `mkdtempSync`.
