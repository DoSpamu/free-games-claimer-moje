# free-games-claimer — Improvements Design

**Date:** 2026-05-04  
**Scope:** All improvements except Humble Bundle / itch.io claimer (F3)  
**Sequence:** Opcja B — quick wins first, architecture last

---

## Overview

12 improvements across 4 categories, implemented sequentially to deliver value early and minimise regression risk. The monolit refactor (T1) goes last so it benefits from patterns established during earlier work.

**Implementation order:**
1. T5 — Remove deprecated `run-scheduled.sh`
2. T2 — Shared browser factory
3. T3 — Steam Guard TOTP
4. R2 — Epic Games VNC warning
5. F1 — Library tab in panel
6. F2 — Game artwork in notifications (Telegram + Discord)
7. R3 — Circuit breaker
8. R1 — GOG session cache
9. F4 — Multi-account support
10. F5 — Credential security
11. T4 — Functional tests
12. T1 — Split `interactive-login.js` monolith

---

## Phase 1 — Foundation (T5, T2, T3, R2)

### T5: Remove `run-scheduled.sh`

File is marked DEPRECATED — scheduling is handled inside `interactive-login.js` via the `LOOP` env var. Remove:
- `run-scheduled.sh`
- Any reference to it in `docker-compose.yml` comments

No behavior change. No migration needed.

---

### T2: Shared Browser Factory

**Problem:** all 6 claimer scripts duplicate an identical ~12-line `chromium.launchPersistentContext(...)` block.

**Solution:** add `launchBrowser(options)` to `src/util.js`:

```js
export const launchBrowser = async (options = {}) => {
  const { browserDir, harPrefix, extraArgs = [], headless = cfg.headless } = options;
  return chromium.launchPersistentContext(browserDir ?? cfg.dir.browser, {
    headless,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
    recordHar: cfg.record && harPrefix ? { path: `data/record/${harPrefix}-${filenamify(datetime())}.har` } : undefined,
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble', ...extraArgs],
  });
};
```

**Per-script overrides:**
- `epic-games.js` — `headless: false` override (captcha avoidance), `extraArgs: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu']`
- `aliexpress.js` — separate `browserDir` (aliexpress profile), `contextOptions: devices['Pixel 7']`
- All others — `launchBrowser({ harPrefix: 'gog' })` with no overrides

Epic Games keeps its custom `headless: false` — the factory accepts an `options.headless` override for this case.

---

### T3: Steam Guard TOTP

**Problem:** `config.js:75` defines `steam_otpkey` but `steam.js` never uses it. Steam is the only service requiring manual 2FA code entry.

**Solution:** apply the same pattern as Epic Games (`epic-games.js:130`) and Prime Gaming (`prime-gaming.js:75`):

```js
// steam.js ~282 — inside Steam Guard handler
const code = (cfg.steam_otpkey && authenticator.generate(cfg.steam_otpkey))
  || await prompt({
       type: 'text',
       message: 'Enter Steam Guard code',
       validate: n => n.toString().length === 5 || 'The code must be 5 characters!',
     });
```

Add `import { authenticator } from 'otplib';` at top of `steam.js` (already a dependency).

Note: Steam Guard codes are 5 characters (not 6 like Epic/Prime) — the existing validate function already handles this correctly.

---

### R2: Epic Games VNC Warning

**Context:** `epic-games.js:43` intentionally sets `headless: false` (comment explains captcha avoidance). This is correct behaviour — not a bug.

**Solution:** add an informational warning when running outside Docker without a display:

```js
// epic-games.js — after browser launch
if (!cfg.novnc_port && !cfg.show && process.platform !== 'win32' && !process.env.DISPLAY) {
  log.warn('Epic Games runs non-headless (captcha avoidance). Outside Docker, ensure a display is available or set SHOW=1.');
}
```

Note: check is skipped on Windows — Windows always has a display manager, `DISPLAY` is a Linux/macOS concept.

Update README: add a note under "Epic Games Store" section explaining why a display/VNC is required and that this is intentional.

---

## Phase 2 — Panel Features (F1, F2)

### F1: Library Tab in Panel

**Data flow:**
```
epic-games.json  ─┐
prime-gaming.json ─┤──→ GET /api/library ──→ Library tab (HTML)
gog.json          ─┤    (normalize+merge)    search / filter / sort / export
steam.json        ─┘
```

**Normalised record format:**
```js
{
  title: string,
  platform: 'epic-games' | 'prime-gaming' | 'gog' | 'steam',
  status: 'claimed' | 'existed' | 'manual',
  time: string,   // ISO datetime
  url: string,
  user: string,
}
```

Records with status `failed` or `skipped` are excluded — these are claimer artefacts, not library entries.

**New module:** `src/panel/library.js` (also created during T1, but implemented here):
```js
export async function readLibrary() {
  // reads all JSON DBs, normalises, merges, sorts by time DESC
}
```

**API endpoint:** `GET /api/library?platform=&status=&q=`
- Server-side filtering on `platform`, `status`, and `q` (title substring match)
- Returns `{ games: [...], total: N }`

**Panel tab — UI elements:**
- Table: Title | Platform | Status | Date | Link (opens in new tab)
- Search input (debounced, filters by title)
- Platform dropdown filter
- Status filter (All / Claimed / Already Owned)
- Row count: "X games in library"
- Export CSV button — generates blob client-side from current filtered results

All rendering is vanilla JS + HTML embedded in `interactive-login.js` (consistent with existing tabs). No new dependencies.

---

### F2: Game Artwork in Notifications (Telegram + Discord)

**Artwork sources:**

| Service | Source | URL pattern |
|---------|--------|-------------|
| Steam | Steam CDN | `https://cdn.cloudflare.steamstatic.com/steam/apps/{appId}/header.jpg` |
| Epic Games | Promotions API (already fetched) | `el.keyImages?.find(img => img.type === 'DieselGameBox')?.url` |
| GOG | GOG Catalog API | `https://catalog.gog.com/v1/catalog?ids={gogId}` → `coverHorizontal` |
| Prime Gaming | — | Skipped (non-uniform, requires scraping) |

**Data flow:** each claimer adds optional `imageUrl` to notify_games entries:
```js
notify_games.push({ title, url, status: 'claimed', imageUrl: '...' });
```

**Telegram changes (`src/util.js`):**

`notifyTelegram` extended with `opts.imageUrl`:
- Single game with `imageUrl` → `sendPhoto` (photo + caption, max 1024 chars)
- Multiple games or no `imageUrl` → existing `sendMessage` (unchanged)

```js
export const notifyTelegram = async (html, opts = {}) => {
  if (!cfg.tg_token || !cfg.tg_chat_id) return;
  const endpoint = opts.imageUrl ? 'sendPhoto' : 'sendMessage';
  const body = opts.imageUrl
    ? { chat_id: cfg.tg_chat_id, photo: opts.imageUrl, caption: html, parse_mode: 'HTML' }
    : { chat_id: cfg.tg_chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
  // ... fetch call unchanged
};
```

**Discord native support (new):**

New env vars: `DISCORD_WEBHOOK` (full webhook URL).
New config schema entry: `notifications.discordWebhook`.
New function `notifyDiscord(games, fallbackText)` in `src/util.js`:

```js
export const notifyDiscord = async (games, fallbackText) => {
  if (!cfg.discord_webhook) return;
  const relevant = games.filter(g => g.status === 'claimed' || g.status === 'failed').slice(0, 10);
  const embeds = relevant.map(g => ({
    title: g.title,
    url: g.url,
    color: g.status === 'claimed' ? 0x57F287 : 0xED4245,
    thumbnail: g.imageUrl ? { url: g.imageUrl } : undefined,
    footer: { text: g.status },
  }));
  await fetch(cfg.discord_webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embeds.length ? { embeds } : { content: fallbackText }),
  });
};
```

Discord embeds support up to 10 per message — no single-game restriction needed. Each embed shows cover art thumbnail, title (linked), status, and colour indicator.

The `notify` wrapper in `src/util.js` fires `notifyTelegram` and `notifyDiscord` in parallel (fire-and-forget, same as existing Telegram call).

---

## Phase 3 — Reliability (R3, R1)

### R3: Circuit Breaker

**State machine:**
```
CLOSED ──(N consecutive failures)──→ OPEN ──(cooldown expires)──→ HALF-OPEN
  ↑                                                                    │
  └─────────────────────(success)────────────────────────────────────┘
```

**Persistence:** `data/circuit-breaker.json` (survives container restarts):
```json
{
  "epic-games": { "failures": 0, "openUntil": null },
  "gog":        { "failures": 3, "openUntil": "2026-05-05T14:00:00.000Z" },
  "steam":      { "failures": 0, "openUntil": null }
}
```

**Configuration (new schema entries in `app-config.js`):**
```
CIRCUIT_BREAKER_THRESHOLD=3   # consecutive failures before opening (default: 3)
CIRCUIT_BREAKER_COOLDOWN=8    # cooldown hours (default: 8)
```

**Scheduler integration** (`interactive-login.js` / future `src/panel/scheduler.js`):

Before spawning a service process:
1. Read `circuit-breaker.json`
2. If `openUntil > now` → skip, log.warn, send one notification (only on transition to OPEN, not on every skipped run)
3. If `openUntil <= now` → HALF-OPEN: run once

After process completes:
- Exit code 0 → reset `failures = 0`, `openUntil = null` (CLOSED), notify if recovering from OPEN
- Exit code ≠ 0 → `failures++`; if `failures >= threshold` → set `openUntil = now + cooldown hours`

**Notifications:**
- On OPEN: `⚡ {service}: circuit breaker opened after {N} failures — skipping for {M}h`
- On recovery: `✓ {service}: circuit breaker closed — service recovered`

**Panel display:** status indicator next to each service card (⚡ OPEN with remaining time, or ✓ CLOSED).

---

### R1: GOG Session Cache

**Problem:** GOG's `checkLogin()` in `interactive-login.js` runs 3 fallback strategies on every panel refresh (navigate to /account → 3 API endpoints → DOM scraping → cookie). Takes 5–8 seconds.

**Solution:** in-memory cache with asymmetric TTL (lives in process memory — resets on restart, acceptable):

```js
const sessionCache = new Map();
// Map<siteKey, { result: { loggedIn, user }, expiresAt: number }>

const SESSION_CACHE_TTL = {
  loggedIn:  30 * 60 * 1000,  // 30 min — stable state
  loggedOut:  5 * 60 * 1000,  // 5 min — may change if user logs in via VNC
};

async function checkLoginCached(siteKey, page) {
  const cached = sessionCache.get(siteKey);
  if (cached && Date.now() < cached.expiresAt) return cached.result;
  const result = await SITES[siteKey].checkLogin(page);
  const ttl = result.loggedIn ? SESSION_CACHE_TTL.loggedIn : SESSION_CACHE_TTL.loggedOut;
  sessionCache.set(siteKey, { result, expiresAt: Date.now() + ttl });
  return result;
}
```

**Cache invalidation:** manual "Check sessions" button in panel calls `sessionCache.delete(siteKey)` before checking — user always gets a fresh result on demand.

Applied to all services (not just GOG), but GOG benefits most due to complexity of its check.

---

## Phase 4 — Auth (F4, F5)

### F4: Multi-account Support

**Core insight:** claimer scripts are standalone processes receiving config via env vars. Multi-account requires no changes to any claimer script — the scheduler runs each script once per configured account.

**New file:** `data/accounts.json`

```json
[
  {
    "id": "alice",
    "label": "My main account",
    "browserDir": "data/browser-alice",
    "services": ["epic-games", "gog", "steam"],
    "env": {
      "EG_EMAIL": "alice@example.com",
      "EG_PASSWORD": "...",
      "EG_OTPKEY": "...",
      "GOG_EMAIL": "alice@example.com",
      "GOG_PASSWORD": "...",
      "STEAM_EMAIL": "alice@example.com",
      "STEAM_PASSWORD": "...",
      "STEAM_OTPKEY": "..."
    }
  }
]
```

**Backwards compatibility:** if `accounts.json` is absent or empty, behaviour is identical to current (single account from env vars). The env-var account is always treated as "account 0" and runs first.

**Scheduler logic:**
1. Load accounts from `accounts.json` (empty array if file absent)
2. Prepend implicit "default account" from env vars (if `EMAIL` or any service email is set)
3. For each account: for each service in `account.services`:
   - Spawn: `node {service}.js` with `{ ...process.env, ...account.env, BROWSER_DIR: account.browserDir }`
4. Accounts run sequentially (not in parallel) — one browser profile at a time

**Panel — new "Accounts" tab:**
- List existing accounts (label, active services count)
- Add account form: label + per-service credential fields
- Test button: runs `checkLogin` for the account's services
- Delete button: removes from `accounts.json` (does NOT delete browser profile — user must do manually to avoid accidental data loss)

**Credentials never go into `config.json`** — `accounts.json` is a separate file. This maintains the existing security separation.

---

### F5: Credential Security

**Current state:** credentials live only in env vars and `data/config.env`. Config.json never contains credentials (enforced by CONFIG_SCHEMA). `accounts.json` (new in F4) is the first JSON file to contain credentials.

**Four layers:**

**1. File permissions**
At startup (in `docker-entrypoint.sh` and node startup in `interactive-login.js`):
```bash
chmod 600 /fgc/data/accounts.json /fgc/data/config.env 2>/dev/null || true
```
If files are world-readable (mode has o+r), emit `log.warn` at startup.

**2. Masking in panel and API**
`accounts.json` credentials are never returned in plain text from any `/api/*` endpoint. Apply `maskLast4()` (already exists in `app-config.js:231`) to all password/otpkey fields in accounts API responses.

**3. `.gitignore` verification**
Ensure `data/` is in `.gitignore`. Add explicit entries for `data/accounts.json` and `data/config.env` if not already covered.

**4. Panel warning banner**
When `accounts.json` exists and contains credentials, panel shows a dismissible warning:
> ⚠ Credentials stored in `data/accounts.json` — ensure this file is not publicly accessible.  
> For better security, use environment variables or Docker secrets instead.

README updated: add security section recommending `--env-file` over inline `-e` flags and explaining the separation between `config.json` (safe to share) and `accounts.json` (sensitive).

---

## Phase 5 — Testing (T4)

**Framework:** Node.js built-in `node:test` + `assert/strict`. Zero new dependencies. ESM-native.

**Run command:** add to `package.json` scripts:
```json
"test": "node --test test/*.test.js"
```

**Test files:**

| File | Covers |
|------|--------|
| `test/util.test.js` | `normalizeTitle`, `escapeHtml`, `filenamify`, `parsePrice` (steam.js) |
| `test/config.test.js` | `getByPath`, `setByPath`, `deleteByPath`, `patchConfig`, `describeConfig` |
| `test/circuit-breaker.test.js` | state machine: CLOSED→OPEN→HALF-OPEN→CLOSED transitions |
| `test/library.test.js` | `normalizeEntry`: maps DB records from each platform to common format |

`parsePrice` (currently in `steam.js`) is extracted to `src/util.js` to make it importable for tests without running the steam script.

**What is NOT tested:** browser automation, login flows, network requests, DOM scraping — these require a live browser and are integration-level concerns.

---

## Phase 6 — Architecture: Split `interactive-login.js` (T1)

**Current state:** ~2400 lines, 5 mixed responsibilities.

**Target structure:**
```
src/panel/
  server.js    — HTTP server, routing, auth middleware, session token management
  html.js      — generatePanelHtml(config) + LOGIN_HTML (pure string functions)
  api.js       — all /api/* route handlers
  scheduler.js — LOOP + MS_SCHEDULE_HOURS + circuit breaker + process spawning
  sessions.js  — SITES object + checkLoginCached() + session cache (R1)
  library.js   — readLibrary() — normalise JSON DBs → common format (F1)

interactive-login.js  — ~50 lines: import modules, start server
```

**Dependency graph (no cycles):**
```
interactive-login.js
    ↓
  server.js ──→ api.js ──→ library.js
      │              └───→ sessions.js
      └──────→ scheduler.js ──→ sessions.js
                              └──→ app-config.js

src/util.js, src/config.js, src/app-config.js — shared leaves, no cycles
```

**Extraction order** (each step = one commit, independently testable):
1. `sessions.js` — extract SITES + checkLogin (no internal deps)
2. `scheduler.js` — extract LOOP/spawn logic
3. `library.js` — extract readLibrary (already implemented in F1)
4. `html.js` — extract HTML strings → pure functions
5. `api.js` — extract route handlers
6. `server.js` — extract HTTP setup + auth
7. `interactive-login.js` — reduce to ~50-line wiring entry point

**Verification:** this is a pure refactor. Tests from T4 must pass before and after each extraction step. Manual panel smoke-test after each commit.

---

## Summary Table

| ID | Description | Files changed | Risk |
|----|-------------|---------------|------|
| T5 | Remove deprecated run-scheduled.sh | `run-scheduled.sh` (delete), `docker-compose.yml` | None |
| T2 | Shared browser factory | `src/util.js` + all `*.js` claimers | Low |
| T3 | Steam Guard TOTP | `steam.js` | Low |
| R2 | Epic VNC warning | `epic-games.js`, `README.md` | None |
| F1 | Library tab | `interactive-login.js`, `src/panel/library.js` | Low |
| F2 | Artwork in notifications | `src/util.js`, all claimers | Low |
| R3 | Circuit breaker | `interactive-login.js`, `src/app-config.js` | Medium |
| R1 | GOG session cache | `interactive-login.js` | Low |
| F4 | Multi-account | `interactive-login.js`, new `data/accounts.json` handling | Medium |
| F5 | Credential security | `interactive-login.js`, `docker-entrypoint.sh`, `README.md` | Low |
| T4 | Functional tests | `test/*.test.js`, `package.json` | None |
| T1 | Split monolith | `interactive-login.js` → `src/panel/*` | High |
