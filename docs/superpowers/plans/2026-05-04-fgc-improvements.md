# FGC Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 12 targeted improvements (T5, T2, T3, R2, F1, F2, R3, R1, F4, F5, T4, T1) across reliability, features, testing, and architecture for free-games-claimer.

**Architecture:** Sequential tasks ordered quick-wins-first. Each task commits independently. The monolith split (T1) goes last so it benefits from all patterns established by earlier work. Panel JS uses only safe DOM APIs (`textContent`, `createElement`, `appendChild`, `replaceChildren`, `insertCell`) — no dynamic HTML string injection.

**Tech Stack:** Node.js 20+, patchright (Chromium), lowdb (JSON DB), otplib (TOTP), node:test (built-in), vanilla JS panel

---

## File Map

**Modified:**
- `src/util.js` — Tasks 2, 6, 11: add `launchBrowser`, extend `notify*`, add `parsePrice`
- `src/app-config.js` — Task 6: add `discordWebhook`, `circuitBreaker*` schema entries
- `src/config.js` — Task 6: expose new cfg fields
- `steam.js` — Tasks 2, 3, 6: browser factory, TOTP, imageUrl
- `epic-games.js` — Tasks 2, 4, 6: browser factory, VNC warning, imageUrl
- `gog.js` — Tasks 2, 6: browser factory, imageUrl
- `prime-gaming.js` — Task 2: browser factory
- `unrealengine.js` — Task 2: browser factory
- `interactive-login.js` — Tasks 5, 7, 8, 9, 10, 12: library API, circuit breaker, session cache, accounts, permissions, split
- `docker-entrypoint.sh` — Task 10: chmod credential files
- `docker-compose.yml` — Task 1: verify no run-scheduled.sh reference
- `package.json` — Task 11: add test script

**Created:**
- `src/panel/library.js` — Task 5
- `src/panel/circuit-breaker.js` — Task 7
- `test/util.test.js`, `test/config.test.js`, `test/circuit-breaker.test.js`, `test/library.test.js` — Task 11
- `src/panel/sessions.js`, `src/panel/scheduler.js`, `src/panel/html.js`, `src/panel/accounts.js`, `src/panel/api.js`, `src/panel/server.js` — Task 12

**Deleted:** `run-scheduled.sh` — Task 1

---

### Task 1: T5 — Remove run-scheduled.sh

**Files:** Delete `run-scheduled.sh`, verify `docker-compose.yml`

- [ ] **Step 1: Delete file from git**

```bash
git rm run-scheduled.sh
```
Expected: `rm 'run-scheduled.sh'`

- [ ] **Step 2: Verify no references remain**

```bash
grep -r "run-scheduled" docker-compose.yml docker-entrypoint.sh Dockerfile 2>/dev/null || echo "clean"
```
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove deprecated run-scheduled.sh (scheduling lives in interactive-login.js)"
```

---

### Task 2: T2 — Shared Browser Factory

**Files:** `src/util.js`, `steam.js`, `gog.js`, `prime-gaming.js`, `unrealengine.js`, `epic-games.js`

- [ ] **Step 1: Add `chromium` import and `launchBrowser` export to `src/util.js`**

At the top of `src/util.js`, after the existing `import path from 'node:path';` line, add:

```js
import { chromium } from 'patchright';
```

At the very end of `src/util.js` (after the `log` export), add:

```js
export const launchBrowser = async (options = {}) => {
  const { browserDir, harPrefix, extraArgs = [], headless = cfg.headless, deviceOptions = {} } = options;
  return chromium.launchPersistentContext(browserDir ?? cfg.dir.browser, {
    headless,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    ...deviceOptions,
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
    recordHar: cfg.record && harPrefix ? { path: `data/record/${harPrefix}-${filenamify(datetime())}.har` } : undefined,
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble', ...extraArgs],
  });
};
```

- [ ] **Step 2: Update `steam.js`**

Remove line 1 (`import { chromium } from 'patchright';`).

Change the util import (line 3) — add `launchBrowser`:
```js
import { resolve, jsonDb, datetime, filenamify, prompt, notify, html_game_list, handleSIGINT, clearBrowserLock, closeContextSafely, writeLastRun, log, dataDir, launchBrowser } from './src/util.js';
```

Replace lines 48-58 (the `chromium.launchPersistentContext` block) with:
```js
const context = await launchBrowser({ harPrefix: 'steam' });
```

- [ ] **Step 3: Update `gog.js`**

Remove line 1 (`import { chromium } from 'patchright';`).

Add `launchBrowser` to line 2 util import (after `awaitUserCaptchaSolve`).

Replace lines 20-30 (launch block) with:
```js
const context = await launchBrowser({ harPrefix: 'gog' });
```

- [ ] **Step 4: Update `prime-gaming.js`**

Remove line 1 (`import { chromium } from 'patchright';`).

Add `launchBrowser` to line 3 util import.

Replace lines 18-28 (launch block) with:
```js
const context = await launchBrowser({ harPrefix: 'pg' });
```

- [ ] **Step 5: Update `unrealengine.js`**

Remove line 4 (`import { chromium } from 'patchright';`).

Add `launchBrowser` to line 8 util import.

Keep the `clearBrowserLock(cfg.dir.browser);` call on line 20. Replace lines 22-34 (launch block) with:
```js
const context = await launchBrowser({ headless: false, harPrefix: 'ue', extraArgs: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
```

- [ ] **Step 6: Update `epic-games.js`**

Keep `import { chromium } from 'patchright';` (used for `chromium.executablePath()` on line 56).

Add `launchBrowser` to line 5 util import.

Replace lines 42-54 (launch block) with:
```js
const context = await launchBrowser({ headless: false, harPrefix: 'eg', extraArgs: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
```

- [ ] **Step 7: Syntax-check all modified files**

```bash
node --check src/util.js && node --check steam.js && node --check gog.js && node --check prime-gaming.js && node --check unrealengine.js && node --check epic-games.js
```
Expected: no output (all pass)

- [ ] **Step 8: Commit**

```bash
git add src/util.js steam.js gog.js prime-gaming.js unrealengine.js epic-games.js
git commit -m "refactor: extract shared launchBrowser factory to src/util.js"
```

---

### Task 3: T3 — Steam Guard TOTP

**Files:** `steam.js`

- [ ] **Step 1: Add `authenticator` import to `steam.js`**

After the import of `writeFileSync` (line 2), add:
```js
import { authenticator } from 'otplib';
```

- [ ] **Step 2: Replace manual-only prompt with TOTP-first logic**

Find the Steam Guard handler. The current code (around line 282 before Task 2 edits, adjusted after):
```js
const code = await prompt({ type: 'text', message: 'Enter Steam Guard code', validate: n => n.toString().length == 5 || 'The code must be 5 characters!' });
```

Replace that single line with:
```js
const code = (cfg.steam_otpkey && authenticator.generate(cfg.steam_otpkey))
  || await prompt({ type: 'text', message: 'Enter Steam Guard code', validate: n => n.toString().length == 5 || 'The code must be 5 characters!' });
if (cfg.steam_otpkey && code) log.info('Steam Guard: used TOTP from STEAM_OTPKEY');
```

- [ ] **Step 3: Syntax-check**

```bash
node --check steam.js
```
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add steam.js
git commit -m "feat: auto-generate Steam Guard TOTP from STEAM_OTPKEY env var"
```

---

### Task 4: R2 — Epic Games VNC Warning

**Files:** `epic-games.js`

- [ ] **Step 1: Add display warning after browser launch**

After the `const context = await launchBrowser(...)` line (now a single line after Task 2), and before the `if (cfg.debug) console.log(chromium.executablePath())` line, insert:

```js
if (!cfg.novnc_port && !cfg.show && process.platform !== 'win32' && !process.env.DISPLAY) {
  log.warn('Epic Games runs non-headless (captcha avoidance). No display detected — ensure DISPLAY is set or run inside Docker with noVNC.');
}
```

- [ ] **Step 2: Syntax-check**

```bash
node --check epic-games.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add epic-games.js
git commit -m "fix: warn when Epic Games launched without a display (headless:false is required)"
```

---

### Task 5: F1 — Library Tab in Panel

**Files:** `src/panel/library.js` (create), `interactive-login.js` (add endpoint + tab)

- [ ] **Step 1: Create `src/panel/` directory**

```bash
mkdir -p src/panel
```

- [ ] **Step 2: Create `src/panel/library.js`**

```js
import { readFileSync, existsSync } from 'node:fs';
import { dataDir } from '../util.js';

export const LIBRARY_STATUSES = new Set(['claimed', 'existed', 'manual']);

const PLATFORM_FILES = {
  'epic-games':   'epic-games.json',
  'prime-gaming': 'prime-gaming.json',
  'gog':          'gog.json',
  'steam':        'steam.json',
};

function readJsonDb(file) {
  const p = dataDir(file);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')) || {}; }
  catch { return {}; }
}

export function normalizeEntry(platform, user, id, record) {
  if (!record || !LIBRARY_STATUSES.has(record.status)) return null;
  return {
    title:    record.title || id,
    platform,
    status:   record.status,
    time:     record.time  || '',
    url:      record.url   || '',
    user:     user         || '',
  };
}

export function readLibrary({ platform, status, q } = {}) {
  const games = [];
  for (const [plat, file] of Object.entries(PLATFORM_FILES)) {
    if (platform && plat !== platform) continue;
    const db = readJsonDb(file);
    for (const [id, record] of Object.entries(db)) {
      const entry = normalizeEntry(plat, '', id, record);
      if (!entry) continue;
      if (status && entry.status !== status) continue;
      if (q && !entry.title.toLowerCase().includes(q.toLowerCase())) continue;
      games.push(entry);
    }
  }
  games.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return { games, total: games.length };
}
```

- [ ] **Step 3: Add import and `/api/library` endpoint to `interactive-login.js`**

Add import at the top (after existing imports):
```js
import { readLibrary } from './src/panel/library.js';
```

In the HTTP request handler, in the API routing block, add:
```js
if (pathname === '/api/library' && req.method === 'GET') {
  if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
  const p = new URL(req.url, 'http://localhost').searchParams;
  const result = readLibrary({
    platform: p.get('platform') || undefined,
    status:   p.get('status')   || undefined,
    q:        p.get('q')        || undefined,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
  return;
}
```

- [ ] **Step 4: Add Library tab button to panel HTML in `interactive-login.js`**

In the panel HTML template, find the tab buttons section (look for `data-tab=`) and add alongside existing tabs:
```html
<button class="tab-btn" data-tab="library">Library</button>
```

- [ ] **Step 5: Add Library tab content to panel HTML**

After the last existing tab content `</div>`, add:
```html
<div id="tab-library" class="tab-content" style="display:none">
  <div class="card">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <input id="lib-q" type="text" placeholder="Search title..." style="flex:1;min-width:140px">
      <select id="lib-platform">
        <option value="">All platforms</option>
        <option value="epic-games">Epic Games</option>
        <option value="prime-gaming">Prime Gaming</option>
        <option value="gog">GOG</option>
        <option value="steam">Steam</option>
      </select>
      <select id="lib-status">
        <option value="">All statuses</option>
        <option value="claimed">Claimed</option>
        <option value="existed">Already owned</option>
      </select>
      <button id="lib-export" class="btn-sm">Export CSV</button>
    </div>
    <div id="lib-count" style="color:#888;font-size:13px;margin-bottom:8px">Loading...</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="border-bottom:1px solid #333;color:#aaa;text-align:left">
          <th style="padding:6px 8px">Title</th><th style="padding:6px 8px">Platform</th>
          <th style="padding:6px 8px">Status</th><th style="padding:6px 8px">Date</th>
          <th style="padding:6px 8px">Link</th>
        </tr>
      </thead>
      <tbody id="lib-tbody"></tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 6: Add Library tab JavaScript to panel `<script>` section**

```js
let _libCache = [];

function libRow(g) {
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid #222';
  [g.title, g.platform, g.status, (g.time || '').slice(0, 10)].forEach(v => {
    const td = tr.insertCell();
    td.style.padding = '5px 8px';
    td.textContent = v;
  });
  const tdLink = tr.insertCell();
  tdLink.style.padding = '5px 8px';
  if (g.url) {
    const a = document.createElement('a');
    a.href = g.url; a.textContent = 'Open';
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.color = '#7aa2f7';
    tdLink.appendChild(a);
  }
  return tr;
}

function renderLib(games) {
  document.getElementById('lib-count').textContent = games.length + ' games in library';
  document.getElementById('lib-tbody').replaceChildren(...games.map(libRow));
}

async function loadLibrary() {
  const params = new URLSearchParams();
  const q = document.getElementById('lib-q').value;
  const platform = document.getElementById('lib-platform').value;
  const status = document.getElementById('lib-status').value;
  if (q) params.set('q', q);
  if (platform) params.set('platform', platform);
  if (status) params.set('status', status);
  const res = await fetch('/api/library?' + params);
  const { games } = await res.json();
  _libCache = games;
  renderLib(games);
}

let _libTimer;
['lib-q', 'lib-platform', 'lib-status'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    clearTimeout(_libTimer);
    _libTimer = setTimeout(loadLibrary, 300);
  });
});

document.getElementById('lib-export')?.addEventListener('click', () => {
  const hdr = 'Title,Platform,Status,Date,URL';
  const rows = _libCache.map(g =>
    [g.title, g.platform, g.status, (g.time || '').slice(0, 10), g.url]
      .map(v => JSON.stringify(v || '')).join(',')
  );
  const blob = new Blob([[hdr, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'library.csv';
  a.click();
});

document.querySelector('[data-tab="library"]')?.addEventListener('click', () => {
  if (!document.getElementById('lib-tbody').children.length) loadLibrary();
});
```

- [ ] **Step 7: Syntax-check**

```bash
node --check interactive-login.js && node --check src/panel/library.js
```
Expected: no output

- [ ] **Step 8: Commit**

```bash
git add src/panel/library.js interactive-login.js
git commit -m "feat: add Library tab with search, platform/status filter, and CSV export"
```

---

### Task 6: F2 — Game Artwork in Notifications (Telegram + Discord)

**Files:** `src/util.js`, `src/app-config.js`, `src/config.js`, `steam.js`, `epic-games.js`, `gog.js`, `prime-gaming.js`

- [ ] **Step 1: Extend `notifyTelegram` in `src/util.js`**

Replace the current `notifyTelegram` function (lines 232–244):

```js
export const notifyTelegram = async (html, opts = {}) => {
  if (!cfg.tg_token || !cfg.tg_chat_id) return;
  try {
    const endpoint = opts.imageUrl ? 'sendPhoto' : 'sendMessage';
    const body = opts.imageUrl
      ? { chat_id: cfg.tg_chat_id, photo: opts.imageUrl, caption: html.slice(0, 1024), parse_mode: 'HTML' }
      : { chat_id: cfg.tg_chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
    const res = await fetch(`https://api.telegram.org/bot${cfg.tg_token}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('Telegram notification error:', await res.text());
  } catch (e) {
    console.error('Telegram notification failed:', e.message);
  }
};
```

- [ ] **Step 2: Add `notifyDiscord` to `src/util.js`** (insert after `notifyTelegram`)

```js
export const notifyDiscord = async (games, fallbackText) => {
  if (!cfg.discord_webhook) return;
  try {
    const relevant = (games || []).filter(g => g.status === 'claimed' || g.status === 'failed').slice(0, 10);
    const embeds = relevant.map(g => ({
      title: g.title,
      url: g.url || undefined,
      color: g.status === 'claimed' ? 0x57F287 : 0xED4245,
      thumbnail: g.imageUrl ? { url: g.imageUrl } : undefined,
      footer: { text: g.status },
    }));
    const payload = embeds.length ? { embeds } : { content: fallbackText };
    const res = await fetch(cfg.discord_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('Discord notification error:', await res.text());
  } catch (e) {
    console.error('Discord notification failed:', e.message);
  }
};
```

- [ ] **Step 3: Update `notify` wrapper to fan out to Discord and pass imageUrl to Telegram**

In `src/util.js`, replace the first two lines of the `notify` function body:
```js
// OLD first line:
notifyTelegram(html).catch(() => {});
```
```js
// NEW first two lines:
const tgImage = opts.games?.length === 1 ? opts.games[0].imageUrl : undefined;
notifyTelegram(html, { imageUrl: tgImage }).catch(() => {});
notifyDiscord(opts.games || [], html).catch(() => {});
```

- [ ] **Step 4: Add `parsePrice` export to `src/util.js`** (insert after `normalizeTitle`)

```js
export const parsePrice = (text) => {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot   = cleaned.lastIndexOf('.');
  const normalized = lastComma > lastDot
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const val = parseFloat(normalized);
  return isNaN(val) ? null : val;
};
```

- [ ] **Step 5: Add schema entries to `src/app-config.js`**

In `CONFIG_SCHEMA`, after the `tgChatId` entry, add:

```js
{ path: 'notifications.discordWebhook',          env: 'DISCORD_WEBHOOK',           type: 'string',  default: '' },
{ path: 'scheduler.circuitBreakerThreshold',     env: 'CIRCUIT_BREAKER_THRESHOLD', type: 'number',  default: 3, coerce: v => Math.max(1, Number(v) || 3) },
{ path: 'scheduler.circuitBreakerCooldownHours', env: 'CIRCUIT_BREAKER_COOLDOWN',  type: 'number',  default: 8, coerce: v => Math.max(1, Number(v) || 8) },
```

- [ ] **Step 6: Add new fields to `cfg` in `src/config.js`**

In `src/config.js`, after `tg_chat_id`:
```js
discord_webhook: notif.discordWebhook || undefined,
circuit_breaker_threshold: sched.circuitBreakerThreshold ?? 3,
circuit_breaker_cooldown_hours: sched.circuitBreakerCooldownHours ?? 8,
```

- [ ] **Step 7: Remove local `parsePrice` from `steam.js` and import shared version**

In `steam.js`:
1. Delete the local `parsePrice` function (lines 23–37).
2. Add `parsePrice` to the util import line.

- [ ] **Step 8: Add `imageUrl` to `steam.js` notify entries**

In `steam.js`, wherever `notify_games.push(...)` is called for a claimed game, add `imageUrl`. The appId is the Steam app numeric ID (variable already present at the push site):

```js
notify_games.push({ title, url: gameUrl, status: 'claimed',
  imageUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg` });
```

Update the end-of-run notify call to pass `games`:
```js
await notify(html_game_list(notify_games), { games: notify_games });
```

- [ ] **Step 9: Add `imageUrl` to `epic-games.js` notify entries**

Change the `offerIdMap` to store objects instead of bare IDs. Replace line 27:
```js
// OLD:
if (slug) offerIdMap[decodeURIComponent(slug).toLowerCase()] = el.id;
```
```js
// NEW:
if (slug) offerIdMap[decodeURIComponent(slug).toLowerCase()] = {
  id: el.id,
  imageUrl: el.keyImages?.find(img => img.type === 'DieselGameBox' || img.type === 'Thumbnail')?.url || null,
};
```

Update all consumers of `offerIdMap[slug]` that previously used the bare string as an offer ID — change to `offerIdMap[slug]?.id`.

When pushing to `notify_games`, add:
```js
notify_games.push({ title, url: gameUrl, status: 'claimed', imageUrl: offerIdMap[slug]?.imageUrl || null });
```

Update end-of-run notify call:
```js
await notify(html_game_list(notify_games), { games: notify_games });
```

- [ ] **Step 10: Add `imageUrl` to `gog.js` notify entries**

When processing each free game, extract og:image before pushing:
```js
const imageUrl = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => null);
notify_games.push({ title, url: gameUrl, status: 'claimed', imageUrl });
```

Update end-of-run notify call:
```js
await notify(html_game_list(notify_games), { games: notify_games });
```

Also update `prime-gaming.js` end-of-run call (no imageUrl, but pass games for Discord):
```js
await notify(html_game_list(notify_games), { games: notify_games });
```

- [ ] **Step 11: Syntax-check all modified files**

```bash
node --check src/util.js src/app-config.js src/config.js steam.js epic-games.js gog.js prime-gaming.js
```
Expected: no output

- [ ] **Step 12: Commit**

```bash
git add src/util.js src/app-config.js src/config.js steam.js epic-games.js gog.js prime-gaming.js
git commit -m "feat: add game artwork to Telegram (sendPhoto) and Discord webhook notifications"
```

---

### Task 7: R3 — Circuit Breaker

**Files:** `src/panel/circuit-breaker.js` (create), `interactive-login.js`

Note: config schema (`circuitBreakerThreshold`, `circuitBreakerCooldownHours`) and `cfg` fields were added in Task 6.

- [ ] **Step 1: Create `src/panel/circuit-breaker.js`**

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function makeCBHelpers(cbFilePath) {
  const dir = path.dirname(cbFilePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  function readState() {
    try {
      if (!existsSync(cbFilePath)) return {};
      return JSON.parse(readFileSync(cbFilePath, 'utf8')) || {};
    } catch { return {}; }
  }

  function writeState(state) {
    try { writeFileSync(cbFilePath, JSON.stringify(state, null, 2) + '\n'); }
    catch (e) { console.error('[circuit-breaker] write failed:', e.message); }
  }

  function isOpen(service, state) {
    const s = state[service];
    return !!(s?.openUntil && new Date(s.openUntil) > new Date());
  }

  function openUntil(service, state) {
    return state[service]?.openUntil || null;
  }

  function recordSuccess(service, state) {
    state[service] = { failures: 0, openUntil: null };
    writeState(state);
  }

  function recordFailure(service, state, threshold, cooldownHours) {
    if (!state[service]) state[service] = { failures: 0, openUntil: null };
    state[service].failures = (state[service].failures || 0) + 1;
    if (state[service].failures >= threshold) {
      state[service].openUntil = new Date(Date.now() + cooldownHours * 3600 * 1000).toISOString();
    }
    writeState(state);
  }

  return { readState, writeState, isOpen, openUntil, recordSuccess, recordFailure };
}
```

- [ ] **Step 2: Import and initialise circuit breaker in `interactive-login.js`**

Add import after existing imports:
```js
import { makeCBHelpers } from './src/panel/circuit-breaker.js';
```

Near where `dataDir` is first used, initialise:
```js
import { dataDir } from './src/util.js'; // already imported via util.js
const CB_FILE = dataDir('circuit-breaker.json');
const cb = makeCBHelpers(CB_FILE);
```

- [ ] **Step 3: Wrap scheduler service spawn with circuit breaker checks**

In the scheduler loop in `interactive-login.js`, for each service being spawned:

```js
// BEFORE spawning service `svc`:
const cbState = cb.readState();
if (cb.isOpen(svc, cbState)) {
  const until = new Date(cb.openUntil(svc, cbState)).toLocaleTimeString();
  log.warn(`Circuit breaker OPEN for ${svc} — skipping until ${until}`);
  continue;
}

// Spawn the child process (existing code, capture exit code):
const exitCode = await new Promise(resolve => {
  const child = spawn('node', [`${svc}.js`], { stdio: 'inherit', env: process.env });
  child.on('close', code => resolve(code));
});

// AFTER spawn completes:
{
  const s = cb.readState();
  if (exitCode === 0) {
    const wasOpen = !!s[svc]?.openUntil;
    cb.recordSuccess(svc, s);
    if (wasOpen) await notify(`Service ${svc} recovered — circuit breaker closed`).catch(() => {});
  } else {
    const wasClosed = !s[svc]?.openUntil;
    cb.recordFailure(svc, s, cfg.circuit_breaker_threshold, cfg.circuit_breaker_cooldown_hours);
    const s2 = cb.readState();
    if (wasClosed && s2[svc]?.openUntil) {
      await notify(`Circuit breaker opened for ${svc} after ${s2[svc].failures} failures — skipping for ${cfg.circuit_breaker_cooldown_hours}h`).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Syntax-check**

```bash
node --check src/panel/circuit-breaker.js && node --check interactive-login.js
```
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add src/panel/circuit-breaker.js interactive-login.js
git commit -m "feat: circuit breaker for failing services (CIRCUIT_BREAKER_THRESHOLD / CIRCUIT_BREAKER_COOLDOWN)"
```

---

### Task 8: R1 — Session Cache

**Files:** `interactive-login.js`

- [ ] **Step 1: Add session cache state at the top of `interactive-login.js`**

After the constants block (after `sessionTokens`), add:
```js
const _sessionCache = new Map(); // siteKey → { result: {loggedIn, user}, expiresAt }
const SESSION_TTL_MS = { loggedIn: 30 * 60 * 1000, loggedOut: 5 * 60 * 1000 };
```

- [ ] **Step 2: Add `checkLoginCached` and `invalidateSession` functions**

```js
async function checkLoginCached(siteKey, page) {
  const entry = _sessionCache.get(siteKey);
  if (entry && Date.now() < entry.expiresAt) return entry.result;
  const result = await SITES[siteKey].checkLogin(page);
  const ttl = result.loggedIn ? SESSION_TTL_MS.loggedIn : SESSION_TTL_MS.loggedOut;
  _sessionCache.set(siteKey, { result, expiresAt: Date.now() + ttl });
  return result;
}

function invalidateSession(siteKey) {
  _sessionCache.delete(siteKey);
}
```

- [ ] **Step 3: Replace direct `checkLogin` calls with `checkLoginCached`**

Find every call in the API handler that reads:
```js
const result = await SITES[key].checkLogin(page);
```

For auto-refresh (periodic checks), replace with:
```js
const result = await checkLoginCached(key, page);
```

For the "Check sessions" / "Refresh" button endpoint, call `invalidateSession` first so the user always gets a live result:
```js
invalidateSession(key);
const result = await checkLoginCached(key, page);
```

- [ ] **Step 4: Syntax-check**

```bash
node --check interactive-login.js
```
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add interactive-login.js
git commit -m "perf: cache session check results (30 min logged-in TTL, 5 min logged-out TTL)"
```

---

### Task 9: F4 — Multi-account Support

**Files:** `interactive-login.js`

- [ ] **Step 1: Add account file helpers to `interactive-login.js`**

Ensure `mkdirSync`, `renameSync` are in the `node:fs` import. Add after constants:

```js
const ACCOUNTS_FILE = dataDir('accounts.json');

function readAccounts() {
  try {
    if (!existsSync(ACCOUNTS_FILE)) return [];
    return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) || [];
  } catch { return []; }
}

function writeAccounts(accounts) {
  mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  const tmp = ACCOUNTS_FILE + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(accounts, null, 2) + '\n');
  renameSync(tmp, ACCOUNTS_FILE);
}

const CRED_PATTERN = /password|otpkey|token|secret|key$/i;

function maskAccountCredentials(account) {
  const masked = { ...account, env: { ...account.env } };
  for (const k of Object.keys(masked.env || {})) {
    if (CRED_PATTERN.test(k)) {
      const v = masked.env[k];
      if (typeof v === 'string' && v.length > 4) masked.env[k] = '••••' + v.slice(-4);
    }
  }
  return masked;
}

function getEffectiveAccounts() {
  const configured = readAccounts();
  const hasEnvCred = process.env.EMAIL || process.env.EG_EMAIL || process.env.GOG_EMAIL || process.env.STEAM_EMAIL;
  const envAccount = hasEnvCred
    ? [{ id: '_env', label: 'Default (env vars)', browserDir: null, services: [], env: {} }]
    : [];
  return [...envAccount, ...configured];
}
```

- [ ] **Step 2: Add accounts API endpoints in the HTTP handler**

```js
if (pathname === '/api/accounts' && req.method === 'GET') {
  if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(readAccounts().map(maskAccountCredentials)));
  return;
}

if (pathname === '/api/accounts' && req.method === 'POST') {
  if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
  let body = '';
  req.on('data', d => (body += d));
  req.on('end', () => {
    try {
      const acct = JSON.parse(body);
      if (!acct.id || !acct.label) { res.writeHead(400); res.end(JSON.stringify({ error: 'id and label required' })); return; }
      const all = readAccounts();
      if (all.find(a => a.id === acct.id)) { res.writeHead(409); res.end(JSON.stringify({ error: 'id already exists' })); return; }
      all.push(acct);
      writeAccounts(all);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(maskAccountCredentials(acct)));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
  });
  return;
}

if (pathname.startsWith('/api/accounts/') && req.method === 'DELETE') {
  if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
  const id = decodeURIComponent(pathname.slice('/api/accounts/'.length));
  writeAccounts(readAccounts().filter(a => a.id !== id));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
  return;
}
```

- [ ] **Step 3: Add Accounts tab button to panel HTML**

```html
<button class="tab-btn" data-tab="accounts">Accounts</button>
```

- [ ] **Step 4: Add Accounts tab content to panel HTML**

```html
<div id="tab-accounts" class="tab-content" style="display:none">
  <div class="card">
    <h3 style="margin-bottom:12px">Configured Accounts</h3>
    <div id="acct-list"></div>
    <hr style="margin:16px 0;border-color:#333">
    <h3 style="margin-bottom:12px">Add Account</h3>
    <form id="acct-form" style="display:flex;flex-direction:column;gap:8px;max-width:480px">
      <input name="id" placeholder="Account ID (e.g. alice)" required>
      <input name="label" placeholder="Label (e.g. My main account)" required>
      <input name="browserDir" placeholder="Browser profile dir (e.g. data/browser-alice)" required>
      <fieldset style="border:1px solid #333;padding:8px;border-radius:6px">
        <legend style="color:#aaa;font-size:12px">Services (comma-separated)</legend>
        <input name="services" placeholder="epic-games,gog,steam">
      </fieldset>
      <fieldset style="border:1px solid #333;padding:8px;border-radius:6px">
        <legend style="color:#aaa;font-size:12px">Credentials (KEY=value per line)</legend>
        <textarea name="env" rows="6" placeholder="EG_EMAIL=alice@example.com&#10;EG_PASSWORD=secret"></textarea>
      </fieldset>
      <button type="submit">Add Account</button>
    </form>
  </div>
</div>
```

- [ ] **Step 5: Add Accounts tab JavaScript**

```js
function renderAccountCard(acct) {
  const div = document.createElement('div');
  div.style.cssText = 'background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
  const info = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = acct.label;
  const sub = document.createElement('div');
  sub.style.cssText = 'color:#888;font-size:12px;margin-top:4px';
  sub.textContent = 'ID: ' + acct.id + ' · Services: ' + ((acct.services || []).join(', ') || 'all') + ' · Dir: ' + (acct.browserDir || 'default');
  info.appendChild(name);
  info.appendChild(sub);
  const del = document.createElement('button');
  del.textContent = 'Delete';
  del.style.cssText = 'background:#c0392b;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px';
  del.addEventListener('click', async () => {
    if (!confirm('Delete account "' + acct.label + '"?')) return;
    await fetch('/api/accounts/' + encodeURIComponent(acct.id), { method: 'DELETE' });
    loadAccounts();
  });
  div.appendChild(info);
  div.appendChild(del);
  return div;
}

async function loadAccounts() {
  const res = await fetch('/api/accounts');
  const accounts = await res.json();
  const list = document.getElementById('acct-list');
  if (!accounts.length) {
    list.textContent = 'No additional accounts configured. Default account comes from env vars.';
    return;
  }
  list.replaceChildren(...accounts.map(renderAccountCard));
}

document.getElementById('acct-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const env = {};
  for (const line of (fd.get('env') || '').split('\n').filter(Boolean)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const acct = {
    id: fd.get('id').trim(), label: fd.get('label').trim(),
    browserDir: fd.get('browserDir').trim(),
    services: (fd.get('services') || '').split(',').map(s => s.trim()).filter(Boolean),
    env,
  };
  const res = await fetch('/api/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(acct),
  });
  if (res.ok) { e.target.reset(); loadAccounts(); }
  else { const j = await res.json(); alert('Error: ' + j.error); }
});

document.querySelector('[data-tab="accounts"]')?.addEventListener('click', loadAccounts);
```

- [ ] **Step 6: Update scheduler to iterate accounts**

In the scheduler loop, wrap the service iteration to run once per account:

```js
for (const account of getEffectiveAccounts()) {
  const accountEnv = { ...process.env, ...account.env };
  if (account.browserDir) accountEnv.BROWSER_DIR = account.browserDir;
  const services = account.services?.length ? account.services : activeServices;
  for (const svc of services) {
    // existing circuit-breaker + spawn logic, but pass `env: accountEnv` to spawn
    const child = spawn('node', [`${svc}.js`], { stdio: 'inherit', env: accountEnv });
    // ...
  }
}
```

(`activeServices` is the existing list derived from cfg `services.*.active` flags.)

- [ ] **Step 7: Syntax-check**

```bash
node --check interactive-login.js
```
Expected: no output

- [ ] **Step 8: Commit**

```bash
git add interactive-login.js
git commit -m "feat: multi-account support via data/accounts.json with Accounts panel tab"
```

---

### Task 10: F5 — Credential Security

**Files:** `interactive-login.js`, `docker-entrypoint.sh`, `.gitignore`

- [ ] **Step 1: Add `statSync` to the `node:fs` import in `interactive-login.js`**

Ensure `statSync` is included in the existing `node:fs` import.

- [ ] **Step 2: Add startup permission check function**

After the `ACCOUNTS_FILE` constant, add:

```js
function checkFilePermissions(filePath, label) {
  try {
    if (!existsSync(filePath)) return;
    const mode = statSync(filePath).mode;
    if ((mode & 0o004) !== 0) log.warn(`${label} is world-readable (mode 0${(mode & 0o777).toString(8)}) — run: chmod 600 "${filePath}"`);
  } catch {}
}
```

Call at startup (before `http.createServer`):
```js
checkFilePermissions(ACCOUNTS_FILE, 'data/accounts.json');
checkFilePermissions(dataDir('config.env'), 'data/config.env');
```

- [ ] **Step 3: Add credential warning banner to panel HTML**

In the panel HTML template, inside the main content wrapper (near the top), add:
```html
<div id="cred-warn" style="display:none;background:#7c2d12;color:#fed7aa;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:13px">
  Credentials stored in data/accounts.json — ensure this file is not publicly accessible.
  For better security, use environment variables or Docker secrets instead.
  <button onclick="this.parentElement.style.display='none'" style="float:right;background:none;border:none;color:#fed7aa;cursor:pointer;font-size:16px">x</button>
</div>
```

In panel JavaScript (at startup after fetching status):
```js
fetch('/api/accounts').then(r => r.json()).then(accounts => {
  const hasCreds = accounts.some(a => Object.keys(a.env || {}).length > 0);
  if (hasCreds) document.getElementById('cred-warn').style.display = 'block';
});
```

- [ ] **Step 4: Update `docker-entrypoint.sh`**

Read `docker-entrypoint.sh` first to find the correct insertion point. Add before the final `exec` line:
```bash
# Restrict credential files to owner-only
chmod 600 /fgc/data/accounts.json /fgc/data/config.env 2>/dev/null || true
```

- [ ] **Step 5: Verify `.gitignore` covers credential files**

```bash
cat .gitignore
```

If `data/` is not already listed, add to `.gitignore`:
```
data/accounts.json
data/config.env
```

- [ ] **Step 6: Syntax-check**

```bash
node --check interactive-login.js && bash -n docker-entrypoint.sh
```
Expected: no output from either

- [ ] **Step 7: Commit**

```bash
git add interactive-login.js docker-entrypoint.sh .gitignore
git commit -m "feat: credential security — startup permission check, masking in API, panel warning"
```

---

### Task 11: T4 — Functional Tests

**Files:** `package.json`, `test/util.test.js`, `test/config.test.js`, `test/circuit-breaker.test.js`, `test/library.test.js`

- [ ] **Step 1: Add test script to `package.json`**

In the `scripts` section of `package.json`, add:
```json
"test": "node --test test/*.test.js"
```

- [ ] **Step 2: Create `test/` directory**

```bash
mkdir -p test
```

- [ ] **Step 3: Create `test/util.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, escapeHtml, filenamify, parsePrice } from '../src/util.js';

test('normalizeTitle lowercases and collapses separators', () => {
  assert.equal(normalizeTitle('The Last of Us: Part II'), 'the last of us part ii');
  assert.equal(normalizeTitle('Hades – Supergiant'), 'hades supergiant');
  assert.equal(normalizeTitle('  spaces  '), 'spaces');
});

test('normalizeTitle strips punctuation', () => {
  assert.equal(normalizeTitle('Tomb Raider™ (2013)'), 'tomb raider 2013');
});

test('normalizeTitle handles null and empty', () => {
  assert.equal(normalizeTitle(''), '');
  assert.equal(normalizeTitle(null), '');
});

test('escapeHtml escapes angle brackets and quotes', () => {
  assert.equal(escapeHtml('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(escapeHtml("it's & done"), "it&#039;s &amp; done");
});

test('filenamify replaces colons with dots', () => {
  assert.equal(filenamify('2024-01-01T12:00:00'), '2024-01-01T12.00.00');
});

test('parsePrice parses US decimal format', () => {
  assert.equal(parsePrice('$19.99'), 19.99);
  assert.equal(parsePrice('1,299.00'), 1299.00);
});

test('parsePrice parses EU comma-decimal format', () => {
  assert.equal(parsePrice('19,99 €'), 19.99);
  assert.equal(parsePrice('1.299,00'), 1299.00);
});

test('parsePrice returns null for non-numeric input', () => {
  assert.equal(parsePrice('Free'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
});
```

- [ ] **Step 4: Create `test/config.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getByPath, setByPath, deleteByPath } from '../src/app-config.js';

test('getByPath retrieves deeply nested value', () => {
  assert.equal(getByPath({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
});

test('getByPath returns undefined for missing path', () => {
  assert.equal(getByPath({}, 'a.b'), undefined);
  assert.equal(getByPath({ a: null }, 'a.b'), undefined);
});

test('setByPath creates nested structure', () => {
  const obj = {};
  setByPath(obj, 'a.b.c', 99);
  assert.deepEqual(obj, { a: { b: { c: 99 } } });
});

test('setByPath overwrites existing value', () => {
  const obj = { a: { b: 1 } };
  setByPath(obj, 'a.b', 2);
  assert.equal(obj.a.b, 2);
});

test('deleteByPath removes key and prunes empty parents', () => {
  const obj = { a: { b: { c: 1 } } };
  deleteByPath(obj, 'a.b.c');
  assert.deepEqual(obj, {});
});

test('deleteByPath leaves non-empty siblings', () => {
  const obj = { a: { b: 1, c: 2 } };
  deleteByPath(obj, 'a.b');
  assert.deepEqual(obj, { a: { c: 2 } });
});

test('deleteByPath is a no-op for missing path', () => {
  const obj = { a: 1 };
  deleteByPath(obj, 'x.y.z');
  assert.deepEqual(obj, { a: 1 });
});
```

- [ ] **Step 5: Create `test/circuit-breaker.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCBHelpers } from '../src/panel/circuit-breaker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function tempCB() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fgc-cb-'));
  const file = path.join(dir, 'cb.json');
  const cb = makeCBHelpers(file);
  return { cb, cleanup: () => rmSync(dir, { recursive: true }) };
}

test('CLOSED by default (no state)', () => {
  const { cb, cleanup } = tempCB();
  try {
    assert.equal(cb.isOpen('epic-games', cb.readState()), false);
  } finally { cleanup(); }
});

test('CLOSED stays CLOSED below threshold', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    cb.recordFailure('gog', s, 3, 8); s = cb.readState();
    assert.equal(cb.isOpen('gog', s), false);
    cb.recordFailure('gog', s, 3, 8); s = cb.readState();
    assert.equal(cb.isOpen('gog', s), false);
  } finally { cleanup(); }
});

test('CLOSED transitions to OPEN at threshold', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    for (let i = 0; i < 3; i++) { cb.recordFailure('gog', s, 3, 8); s = cb.readState(); }
    assert.equal(cb.isOpen('gog', s), true);
    assert.ok(s['gog'].openUntil);
  } finally { cleanup(); }
});

test('OPEN transitions to CLOSED on success', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    cb.recordFailure('steam', s, 1, 8); s = cb.readState();
    assert.equal(cb.isOpen('steam', s), true);
    cb.recordSuccess('steam', s); s = cb.readState();
    assert.equal(cb.isOpen('steam', s), false);
    assert.equal(s['steam'].failures, 0);
    assert.equal(s['steam'].openUntil, null);
  } finally { cleanup(); }
});

test('HALF-OPEN: expired openUntil reads as closed', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    s['gog'] = { failures: 3, openUntil: new Date(Date.now() - 1000).toISOString() };
    cb.writeState(s); s = cb.readState();
    assert.equal(cb.isOpen('gog', s), false);
  } finally { cleanup(); }
});
```

- [ ] **Step 6: Create `test/library.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, LIBRARY_STATUSES } from '../src/panel/library.js';

test('normalizeEntry maps a claimed record correctly', () => {
  const result = normalizeEntry('epic-games', '', 'control', {
    title: 'Control', status: 'claimed',
    time: '2024-01-15 10:30:00',
    url: 'https://store.epicgames.com/en-US/p/control',
  });
  assert.deepEqual(result, {
    title: 'Control', platform: 'epic-games', status: 'claimed',
    time: '2024-01-15 10:30:00',
    url: 'https://store.epicgames.com/en-US/p/control', user: '',
  });
});

test('normalizeEntry uses id as title when title is absent', () => {
  const result = normalizeEntry('gog', '', 'control', { status: 'existed', time: '', url: '' });
  assert.equal(result.title, 'control');
});

test('normalizeEntry returns null for excluded statuses', () => {
  assert.equal(normalizeEntry('steam', '', 'x', { status: 'failed' }), null);
  assert.equal(normalizeEntry('steam', '', 'x', { status: 'skipped' }), null);
  assert.equal(normalizeEntry('steam', '', 'x', { status: 'ignored' }), null);
});

test('normalizeEntry returns null for null record', () => {
  assert.equal(normalizeEntry('gog', '', 'x', null), null);
});

test('LIBRARY_STATUSES includes claimed, existed, manual', () => {
  assert.ok(LIBRARY_STATUSES.has('claimed'));
  assert.ok(LIBRARY_STATUSES.has('existed'));
  assert.ok(LIBRARY_STATUSES.has('manual'));
  assert.ok(!LIBRARY_STATUSES.has('failed'));
  assert.ok(!LIBRARY_STATUSES.has('skipped'));
});
```

- [ ] **Step 7: Run tests**

```bash
npm test
```
Expected: all tests pass, output ends with:
```
ℹ tests 22
ℹ pass 22
ℹ fail 0
```

- [ ] **Step 8: Commit**

```bash
git add package.json test/
git commit -m "test: add node:test suite for util, config, circuit-breaker, library"
```

---

### Task 12: T1 — Split `interactive-login.js` Monolith

**Goal:** Extract 6 modules in dependency order. Each extraction is one commit. `interactive-login.js` ends at ~50 lines.

**Rule:** Run `npm test` before and after every extraction step. Smoke-test the panel in a browser after each commit.

**Dependency order (extract leaves first):**
```
sessions.js  ←  no internal deps
accounts.js  ←  no internal deps
library.js   ←  already exists (Task 5); no move needed
html.js      ←  depends only on config/util
scheduler.js ←  depends on sessions, accounts, circuit-breaker
api.js       ←  depends on sessions, library, accounts
server.js    ←  depends on api, html
```

- [ ] **Step 1: Extract `src/panel/sessions.js`**

Create `src/panel/sessions.js` containing:
- The `SITES` object (all per-service objects with their `checkLogin` implementations)
- The `_sessionCache` Map and `SESSION_TTL_MS` constants
- `checkLoginCached(siteKey, page)` function
- `invalidateSession(siteKey)` function

Exports: `{ SITES, checkLoginCached, invalidateSession }`

The module needs these imports:
```js
import { chromium, devices } from 'patchright';
import { datetime, notify, jsonDb, normalizeTitle } from '../util.js';
import { cfg } from '../config.js';
```

In `interactive-login.js`, delete those definitions and add:
```js
import { SITES, checkLoginCached, invalidateSession } from './src/panel/sessions.js';
```

Run `npm test`. Smoke-test panel. Commit:
```bash
git add src/panel/sessions.js interactive-login.js
git commit -m "refactor: extract SITES and session cache to src/panel/sessions.js"
```

- [ ] **Step 2: Extract `src/panel/accounts.js`**

Create `src/panel/accounts.js` containing:
- `ACCOUNTS_FILE` path constant
- `readAccounts()`, `writeAccounts()`, `maskAccountCredentials()`, `getEffectiveAccounts()`
- `CRED_PATTERN` regex constant

Exports: `{ ACCOUNTS_FILE, readAccounts, writeAccounts, maskAccountCredentials, getEffectiveAccounts }`

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../util.js';
```

In `interactive-login.js` and `scheduler.js` (if already extracted), replace with:
```js
import { readAccounts, writeAccounts, maskAccountCredentials, getEffectiveAccounts } from './src/panel/accounts.js';
```

Run `npm test`. Smoke-test panel. Commit:
```bash
git add src/panel/accounts.js interactive-login.js
git commit -m "refactor: extract accounts CRUD to src/panel/accounts.js"
```

- [ ] **Step 3: Extract `src/panel/html.js`**

Create `src/panel/html.js` containing:
- `LOGIN_HTML` string
- `generatePanelHtml(config)` function (the main template function, including all tab HTML)

Exports: `{ LOGIN_HTML, generatePanelHtml }`

In `interactive-login.js`, replace with:
```js
import { LOGIN_HTML, generatePanelHtml } from './src/panel/html.js';
```

Run `npm test`. Smoke-test panel. Commit:
```bash
git add src/panel/html.js interactive-login.js
git commit -m "refactor: extract panel HTML generation to src/panel/html.js"
```

- [ ] **Step 4: Extract `src/panel/scheduler.js`**

Create `src/panel/scheduler.js` containing:
- Circuit breaker `cb` instance initialisation
- `startScheduler()` function (the `LOOP` interval logic, account iteration, service spawning)

Exports: `{ startScheduler }`

```js
import { spawn } from 'node:child_process';
import { cfg } from '../config.js';
import { getSchedulerConfig } from '../app-config.js';
import { makeCBHelpers } from './circuit-breaker.js';
import { getEffectiveAccounts } from './accounts.js';
import { dataDir, notify, writeLastRun, log } from '../util.js';

const CB_FILE = dataDir('circuit-breaker.json');
export const cb = makeCBHelpers(CB_FILE);
```

In `interactive-login.js`, replace scheduler code with:
```js
import { startScheduler } from './src/panel/scheduler.js';
```

Run `npm test`. Smoke-test panel. Commit:
```bash
git add src/panel/scheduler.js interactive-login.js
git commit -m "refactor: extract scheduler loop and spawn logic to src/panel/scheduler.js"
```

- [ ] **Step 5: Extract `src/panel/api.js`**

Create `src/panel/api.js` containing all `/api/*` route handlers as a single dispatch function.

```js
import { SITES, checkLoginCached, invalidateSession } from './sessions.js';
import { readLibrary } from './library.js';
import { readAccounts, writeAccounts, maskAccountCredentials } from './accounts.js';
import { describeConfig, patchConfig, describeEnv } from '../app-config.js';
import { cb } from './scheduler.js';

export async function handleApiRequest(req, res, { isAuthenticated }) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (!isAuthenticated(req) && !pathname.startsWith('/api/auth')) {
    res.writeHead(401); res.end('Unauthorized'); return;
  }
  // ... route dispatch for all /api/* paths
}
```

In `interactive-login.js` (or `server.js`), replace with:
```js
import { handleApiRequest } from './src/panel/api.js';
```

Run `npm test`. Smoke-test panel. Commit:
```bash
git add src/panel/api.js interactive-login.js
git commit -m "refactor: extract API route handlers to src/panel/api.js"
```

- [ ] **Step 6: Extract `src/panel/server.js` and reduce `interactive-login.js`**

Create `src/panel/server.js` containing:
- `sessionTokens` Set, `generateToken()`, `isAuthenticated()`
- HTTP server creation and request routing
- Static asset serving

Exports: `{ startServer }`

`interactive-login.js` reduces to:
```js
import { startServer } from './src/panel/server.js';
import { startScheduler } from './src/panel/scheduler.js';

const PANEL_PORT = Number(process.env.PANEL_PORT) || 7080;
startServer(PANEL_PORT);
if (process.env.LOOP || process.env.MS_SCHEDULE_HOURS) startScheduler();
console.log(`Panel: http://localhost:${PANEL_PORT}`);
```

Run `npm test`. Smoke-test panel.

```bash
wc -l interactive-login.js
```
Expected: ≤ 60 lines.

```bash
git add src/panel/server.js interactive-login.js
git commit -m "refactor: extract HTTP server to src/panel/server.js — interactive-login.js is now ~50 lines"
```

- [ ] **Step 7: Final check**

```bash
npm test && node --check interactive-login.js src/panel/*.js
git log --oneline -8
```
Expected: 6 clean extraction commits, all tests pass.

---

## Self-Review

**Spec coverage:**
- T5 ✓ (Task 1), T2 ✓ (Task 2), T3 ✓ (Task 3), R2 ✓ (Task 4)
- F1 Library tab ✓ (Task 5), F2 artwork Telegram+Discord ✓ (Task 6)
- R3 Circuit breaker ✓ (Task 7), R1 Session cache ✓ (Task 8)
- F4 Multi-account ✓ (Task 9), F5 Credential security ✓ (Task 10)
- T4 Tests ✓ (Task 11), T1 Monolith split ✓ (Task 12)

**Type consistency:** `notifyTelegram(html, opts)` signature used consistently throughout Tasks 6 and later. `makeCBHelpers` returns the same `{ readState, writeState, isOpen, openUntil, recordSuccess, recordFailure }` shape used in both Task 7 (integration) and Task 11 (tests). `normalizeEntry` signature `(platform, user, id, record)` consistent between Task 5 (library.js) and Task 11 (library.test.js).

**aliexpress.js is excluded from Task 2** — it uses custom mobile fingerprinting (`FingerprintGenerator` with `devices: ['android']`, non-standard viewport from fingerprint) incompatible with the shared factory.
