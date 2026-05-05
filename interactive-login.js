import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { watch, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __panelDirname = path.dirname(fileURLToPath(import.meta.url));
import { chromium } from 'patchright';

async function launchContext(browserDir, options = {}) {
  if (process.env.BROWSER_TYPE === 'firefox') {
    const { firefox } = await import('playwright');
    const { args: _args, ...rest } = options;
    return firefox.launchPersistentContext(browserDir, {
      ...rest,
      firefoxUserPrefs: { 'dom.webdriver.enabled': false },
    });
  }
  return chromium.launchPersistentContext(browserDir, { channel: 'chrome', ...options });
}
import { datetime, notify, jsonDb, normalizeTitle, dataDir, clearBrowserLock } from './src/util.js';
import { readLibrary } from './src/panel/library.js';
import { makeCBHelpers } from './src/panel/circuit-breaker.js';
import { ACCOUNTS_FILE, readAccounts, writeAccounts, maskAccountCredentials, getEffectiveAccounts } from './src/panel/accounts.js';
import { SITES, checkLoginCached, invalidateSession } from './src/panel/sessions.js';
import { LOGIN_HTML, PANEL_HTML } from './src/panel/html.js';
import { cfg } from './src/config.js';
import { describeConfig, patchConfig, describeEnv, getSchedulerConfig, CONFIG_FILE_PATH } from './src/app-config.js';

const cb = makeCBHelpers(dataDir('circuit-breaker.json'));

function checkFilePermissions(filePath, label) {
  try {
    if (!existsSync(filePath)) return;
    const mode = statSync(filePath).mode;
    if ((mode & 0o004) !== 0) log.warn(`${label} is world-readable (mode 0${(mode & 0o777).toString(8)}) — run: chmod 600 "${filePath}"`);
  } catch {}
}

const PANEL_PORT = Number(process.env.PANEL_PORT) || 7080;
const NOVNC_PORT = process.env.NOVNC_PORT || 6080;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || process.env.VNC_PASSWORD || '';
const BASE_PATH = cfg.base_path; // e.g. "/free-games" when behind a subfolder proxy, or ""
const PUBLIC_URL = cfg.public_url || `http://localhost:${PANEL_PORT}${BASE_PATH}`;
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(__panelDirname, 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();

import crypto from 'node:crypto';
const sessionTokens = new Set();

function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessionTokens.add(token);
  return token;
}

function isAuthenticated(req) {
  if (!PANEL_PASSWORD) return true;
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/fgc_token=([a-f0-9]+)/);
  if (match && sessionTokens.has(match[1])) return true;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && sessionTokens.has(auth.slice(7))) return true;
  return false;
}


let activeBrowser = null;
const siteStatus = {};
for (const id of Object.keys(SITES)) {
  siteStatus[id] = { status: 'unknown', user: null, checkedAt: null };
}

async function launchSite(siteId) {
  // launchSite may legitimately replace an existing activeBrowser, so we allow
  // that case and closeBrowser() below. Any other busy reason is a hard error.
  const busy = browserBusy({ allowActiveBrowser: true });
  if (busy) throw new Error(`Cannot launch browser — ${busy}.`);
  if (activeBrowser) {
    await closeBrowser();
  }
  const site = SITES[siteId];
  if (!site) throw new Error(`Unknown site: ${siteId}`);

  console.log(`[${datetime()}] Launching browser for ${site.name}...`);
  clearBrowserLock(site.browserDir);

  const context = await launchContext(site.browserDir, {
    headless: false,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble'],
    ...(site.contextOptions || {}),
  });

  context.setDefaultTimeout(0);

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  if (!site.contextOptions?.viewport) await page.setViewportSize({ width: cfg.width, height: cfg.height });
  await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded' });

  activeBrowser = { siteId, context, page };
  console.log(`[${datetime()}] Browser launched for ${site.name}. User can now log in via VNC.`);
  return { success: true, site: siteId, name: site.name };
}

async function verifyAndClose() {
  if (!activeBrowser) {
    return { success: false, error: 'No browser is currently open.' };
  }
  const { siteId, context, page } = activeBrowser;
  const site = SITES[siteId];

  console.log(`[${datetime()}] Verifying login for ${site.name}...`);

  const result = await site.checkLogin(page);

  if (result.loggedIn) {
    console.log(`[${datetime()}] Login verified for ${site.name} as ${result.user}. Saving session.`);
    siteStatus[siteId] = { status: 'logged_in', user: result.user, checkedAt: datetime() };
    await context.close();
    activeBrowser = null;
    return { success: true, loggedIn: true, user: result.user, site: siteId };
  } else {
    console.log(`[${datetime()}] Login NOT detected for ${site.name}. Browser remains open.`);
    return { success: true, loggedIn: false, site: siteId, message: 'Login not detected. Please complete the login process and try again.' };
  }
}

async function closeBrowser() {
  if (!activeBrowser) return;
  console.log(`[${datetime()}] Closing browser for ${SITES[activeBrowser.siteId].name}.`);
  try {
    await activeBrowser.context.close();
  } catch {}
  activeBrowser = null;
}

let checkInProgress = false;

async function checkSiteStatus(siteId) {
  const site = SITES[siteId];
  if (!site) return { loggedIn: false, error: 'Unknown site' };

  const busy = browserBusy();
  if (busy) return { error: `Browser profile busy — ${busy}.` };

  checkInProgress = true;
  console.log(`[${datetime()}] Checking session status for ${site.name} (headless)...`);

  let context;
  try {
    clearBrowserLock(site.browserDir);
    context = await launchContext(site.browserDir, {
      headless: false,
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      handleSIGINT: false,
      args: ['--hide-crash-restore-bubble', '--no-sandbox', '--disable-gpu'],
      ...(site.contextOptions || {}),
    });

    const page = context.pages()[0] || await context.newPage();
    const result = await checkLoginCached(siteId, page);
    siteStatus[siteId] = {
      status: result.loggedIn ? 'logged_in' : 'not_logged_in',
      user: result.user || null,
      checkedAt: datetime(),
    };
    console.log(`[${datetime()}] ${site.name}: ${result.loggedIn ? `logged in as ${result.user}` : 'not logged in'}`);
    return { ...result, site: siteId };
  } catch (e) {
    console.error(`[${datetime()}] Check failed for ${site.name}:`, e.message);
    siteStatus[siteId] = { status: 'error', user: null, checkedAt: datetime() };
    return { loggedIn: false, site: siteId, error: e.message };
  } finally {
    if (context) {
      try { await context.close(); } catch {}
    }
    checkInProgress = false;
  }
}

let runProcess = null;
let runDone = null; // Promise that resolves when runProcess finishes (for scheduler to await)
let runLog = [];
let runStatus = 'idle';
let runSource = null; // 'panel' | 'scheduler'
let lastRun = null; // { at, source, exitCode, status, startedAt, durationSec }
let runStartedAt = null;
// Set when a runner script emits [CAPTCHA-START] on stdout, cleared on
// [CAPTCHA-END] or run process exit. Drives the captcha banner + the
// ?focus=captcha deep link target. { service, label, since } when active.
let captchaPending = null;
let startupAutoCheck = null; // { current, total, siteName } while auto-check is walking sites

// gog.js runs first so its Prime-Gaming-code reconcile (library + redeem-endpoint
// probe) updates prime-gaming.json BEFORE prime-gaming.js fires its pending-redeem
// notification. Otherwise the notification goes out with a stale pending count.
// Two command sets so "Run Now" finishes in ~5 min instead of hanging until the
// next morning: microsoft.js has an internal MS_SCHEDULE_HOURS sleep that can
// hold the subprocess open for up to 20 hours, which is correct for the
// scheduled-daily path but wrong for interactive "run these now".
//   CLAIM_CMD         — full set, used by the scheduler at its anchored wake.
//   CLAIM_CMD_MANUAL  — subset (no microsoft.js), used by the "Run Now" button.
// Claim script order when running every active service. microsoft.js is last
// because it has an internal wait-until-window that blocks the process; put
// it after everything else so the rest finishes promptly. microsoft.js is
// shared between the 'microsoft' (desktop) and 'microsoft-mobile' site cards
// — invoked once and runs both sessions internally.
const CLAIM_SCRIPT_ORDER = [
  { id: 'gog',              script: 'gog.js' },
  { id: 'prime-gaming',     script: 'prime-gaming.js' },
  { id: 'epic-games',       script: 'epic-games.js' },
  { id: 'steam',            script: 'steam.js' },
  { id: 'aliexpress',       script: 'aliexpress.js' },
  { id: 'ubisoft',          script: 'ubisoft.js' }, // watch-only: notifies on new free games, no claim flow
  { id: 'microsoft',        script: 'microsoft.js', linkedWith: 'microsoft-mobile' }, // omitted from "manual" runs by default
];

function activeServices() {
  const svc = describeConfig().effective.services || {};
  const optInIds = new Set(['aliexpress', 'ubisoft']); // opt-in services default off
  const isActive = id => {
    const s = svc[id];
    if (s && typeof s.active === 'boolean') return s.active;
    return !optInIds.has(id);
  };
  return new Set(Object.keys({
    'prime-gaming': 1, 'epic-games': 1, 'gog': 1, 'steam': 1,
    'microsoft': 1, 'microsoft-mobile': 1, 'aliexpress': 1, 'ubisoft': 1,
  }).filter(isActive));
}

// Build the shell command for a claim run.
//   opts.manual=true → drop microsoft.js (it has an internal wait-until-window
//                      that a "Run Now" press shouldn't trigger).
//   opts.sites=[...] → explicit list of service IDs to run, bypasses the
//                      active-set filter and the manual=true MS exclusion.
//                      Used by per-card "Run" buttons for single-service
//                      test runs.
// If nothing matches, returns null so the caller can report it.
function buildClaimCommand({ manual = false, sites = null } = {}) {
  const targetSet = sites ? new Set(sites) : activeServices();
  const cbState = !sites ? cb.readState() : {}; // skip CB check for explicit single-service runs
  const parts = [];
  for (const entry of CLAIM_SCRIPT_ORDER) {
    if (!sites && manual && entry.id === 'microsoft') continue;
    // microsoft.js covers both desktop + mobile — invoke once if either ID is in the target set.
    const ids = [entry.id].concat(entry.linkedWith ? [entry.linkedWith] : []);
    if (!ids.some(id => targetSet.has(id))) continue;
    // Skip services with an open circuit breaker (scheduled runs only, not explicit sites)
    if (!sites && cb.isOpen(entry.id, cbState)) {
      const until = new Date(cb.openUntil(entry.id, cbState)).toLocaleString();
      console.log(`[${datetime()}] Circuit breaker OPEN for ${entry.id} — skipping until ${until}`);
      continue;
    }
    parts.push(`node ${entry.script}; echo "SVCRESULT:${entry.id}:$?"`);
  }
  return parts.length ? parts.join('; ') : null;
}

// Env overrides let people keep the original hard-coded pipelines if they
// want (e.g. adding a custom pre/post step). Bypassed when sites is set —
// per-card Run runs exactly the requested service.
function resolveClaimCommand({ manual, sites = null }) {
  if (!sites) {
    const envKey = manual ? 'CLAIM_CMD_MANUAL' : 'CLAIM_CMD';
    if (process.env[envKey]) return process.env[envKey];
  }
  return buildClaimCommand({ manual, sites });
}

// Unified profile-busy check. The chromium user-data-dir only supports one
// process at a time — four distinct code paths can hold it: session-checks
// (checkSiteStatus), interactive login sessions (activeBrowser), scheduled
// or manual claim runs (runProcess), and batch redeem (batchRedeem). Any
// entry point that wants the profile must check this first. Returns a human
// description of what's busy, or null.
function browserBusy({ allowActiveBrowser = false } = {}) {
  if (checkInProgress) return 'auto-checking session status';
  if (runProcess) return `claim run in progress${runSource ? ' (' + runSource + ')' : ''}`;
  if (!allowActiveBrowser && activeBrowser) {
    const name = SITES[activeBrowser.siteId]?.name || activeBrowser.siteId;
    return `interactive browser session active for ${name}`;
  }
  if (batchRedeem && batchRedeem.phase !== 'done' && batchRedeem.phase !== 'stopped' && batchRedeem.phase !== 'error') {
    return 'batch redeem in progress';
  }
  return null;
}

// ----- Batch redeem -----
// Drives the GOG /redeem page programmatically for each entry in
// prime-gaming.json that's store=gog.com, has a code, and hasn't been
// marked redeemed. Auto-clicks Continue → Redeem for each code. When
// GOG demands a captcha, pauses and lets the user solve it via noVNC;
// polls the page DOM for completion then moves on.
let batchRedeem = null;

function collectPendingGogCodes(pgDb) {
  const pending = [];
  for (const games of Object.values(pgDb.data || {})) {
    if (!games || typeof games !== 'object') continue;
    for (const [title, entry] of Object.entries(games)) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.store !== 'gog.com' || !entry.code) continue;
      if (/redeemed|expired|invalid/i.test(String(entry.status || ''))) continue;
      pending.push({ title, entry });
    }
  }
  return pending;
}

async function countPendingGogCodes() {
  try {
    const pgDb = await jsonDb('prime-gaming.json', {});
    return collectPendingGogCodes(pgDb).length;
  } catch {
    return 0;
  }
}

async function processOneRedeemCode(page, code) {
  await page.goto(`https://www.gog.com/redeem/${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  // URL-based pre-fill usually works; fall back to filling #codeInput explicitly.
  try { await page.fill('#codeInput', code); } catch {}
  // Click Continue — GOG fires GET /v1/bonusCodes/<code> in response.
  const r1Promise = page.waitForResponse(
    r => r.request().method() === 'GET' && r.url().startsWith('https://redeem.gog.com/v1/bonusCodes/'),
    { timeout: 20000 },
  );
  await page.click('[type="submit"]');
  const r1 = await r1Promise;
  const r1t = await r1.text();
  let r1j = {}; try { r1j = JSON.parse(r1t); } catch {}
  const reason1 = String(r1j.reason || '').toLowerCase();
  if (reason1 === 'code_used') return { outcome: 'used' };
  if (reason1 === 'code_not_found') return { outcome: 'not-found' };
  if (reason1.includes('captcha')) return { outcome: 'captcha', productTitle: null };
  // Valid — click Redeem; GOG fires POST /v1/bonusCodes/<code>.
  const r2Promise = page.waitForResponse(
    r => r.request().method() === 'POST' && r.url().startsWith('https://redeem.gog.com/v1/bonusCodes/'),
    { timeout: 20000 },
  );
  await page.click('[type="submit"]');
  const r2 = await r2Promise;
  const r2t = await r2.text();
  let r2j = {}; try { r2j = JSON.parse(r2t); } catch {}
  const reason2 = String(r2j.reason2 || r2j.reason || '').toLowerCase();
  if (r2j.type === 'async_processing') {
    await page.locator('h1:has-text("Code redeemed successfully!")').waitFor({ timeout: 15000 }).catch(() => {});
    return { outcome: 'redeemed', productTitle: r1j.products?.[0]?.title };
  }
  if (reason2.includes('captcha')) return { outcome: 'captcha', productTitle: r1j.products?.[0]?.title };
  return { outcome: 'unknown', raw: r2j };
}

async function waitForCaptchaResolution(page) {
  // User solves captcha + clicks Redeem themselves. Poll DOM for result.
  const deadline = Date.now() + 10 * 60 * 1000; // 10 min max per code
  while (Date.now() < deadline) {
    if (!batchRedeem || batchRedeem.phase === 'stopped') return 'stopped';
    try {
      if (await page.locator('h1:has-text("Code redeemed successfully!")').count() > 0) return 'redeemed';
      if (await page.locator('text=/already redeemed|already used|code was used|code used/i').count() > 0) return 'used';
      if (await page.locator('text=/not found|invalid code|doesn.t exist|incorrect/i').count() > 0) return 'not-found';
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return 'timeout';
}

async function fetchGogLibraryTitles(page) {
  const titles = new Set();
  let pageNum = 1, totalPages = 1;
  do {
    const body = await page.evaluate(async p => {
      const r = await fetch(`https://www.gog.com/account/getFilteredProducts?mediaType=1&page=${p}&sortBy=title`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }, pageNum);
    const j = JSON.parse(body);
    totalPages = j.totalPages || 1;
    for (const product of j.products || []) {
      if (product?.title) titles.add(normalizeTitle(product.title));
    }
    pageNum++;
  } while (pageNum <= totalPages && pageNum <= 30);
  return titles;
}

async function runBatchRedeemLoop() {
  // Load library once up front. When GOG returns code_used, we cross-check
  // against the library — "code_used" at GOG is the same response whether
  // the code actually added the game to your account or was consumed without
  // crediting (expired / old-account / GOG weirdness). The library is the
  // ground truth for whether you actually own it.
  let libraryTitles = new Set();
  try {
    batchRedeem.message = 'Loading GOG library…';
    batchRedeem.updatedAt = datetime();
    libraryTitles = await fetchGogLibraryTitles(batchRedeem.page);
    console.log(`[${datetime()}] Batch redeem: library has ${libraryTitles.size} titles`);
  } catch (e) {
    console.log(`[${datetime()}] Batch redeem: library fetch failed, can't verify code_used against ownership — ${e.message}`);
  }

  while (batchRedeem && batchRedeem.index < batchRedeem.pending.length && batchRedeem.phase !== 'stopped') {
    const { title, entry } = batchRedeem.pending[batchRedeem.index];
    batchRedeem.currentTitle = title;
    batchRedeem.currentCode = entry.code;
    batchRedeem.message = `Processing ${title}…`;
    batchRedeem.updatedAt = datetime();

    let result;
    try {
      result = await processOneRedeemCode(batchRedeem.page, entry.code);
    } catch (e) {
      console.error(`[${datetime()}] Batch redeem: ${title} — ${e.message}`);
      result = { outcome: 'error', error: e.message };
    }

    let finalOutcome = result.outcome;
    if (result.outcome === 'captcha') {
      batchRedeem.phase = 'awaiting-captcha';
      batchRedeem.message = `Solve captcha + click Redeem for "${title}" in the browser — auto-continuing when done.`;
      batchRedeem.updatedAt = datetime();
      finalOutcome = await waitForCaptchaResolution(batchRedeem.page);
      if (finalOutcome === 'stopped') break;
      batchRedeem.phase = 'running';
    }

    if (finalOutcome === 'redeemed') {
      entry.status = 'claimed and redeemed (batch)';
      batchRedeem.stats.redeemed++;
    } else if (finalOutcome === 'used') {
      // GOG says the code is consumed. Cross-check the library to distinguish
      // truly-redeemed (game in library) from consumed-but-lost (expired).
      if (libraryTitles.size > 0 && libraryTitles.has(normalizeTitle(title))) {
        entry.status = 'claimed and redeemed (verified via GOG)';
        batchRedeem.stats.used++;
      } else {
        entry.status = 'claimed, code consumed but not in library (likely expired)';
        batchRedeem.stats.notFound++; // count under "invalid" since it's not redeemable
        console.log(`[${datetime()}] Batch redeem: ${title} — GOG says code_used but title not in library; marking as expired`);
      }
    } else if (finalOutcome === 'not-found') {
      entry.status = 'claimed, code expired or invalid';
      batchRedeem.stats.notFound++;
    } else if (finalOutcome === 'timeout') {
      batchRedeem.stats.timeouts++;
      console.log(`[${datetime()}] Batch redeem: ${title} — timed out, moving on`);
    } else if (finalOutcome === 'error') {
      batchRedeem.stats.errors++;
    } else {
      batchRedeem.stats.unknown++;
    }
    try { await batchRedeem.pgDb.write(); } catch {}

    batchRedeem.index++;
  }

  if (batchRedeem) {
    batchRedeem.phase = batchRedeem.phase === 'stopped' ? 'stopped' : 'done';
    const s = batchRedeem.stats;
    batchRedeem.message = `Batch ${batchRedeem.phase} — ${s.redeemed} redeemed, ${s.used} already, ${s.notFound} invalid${s.errors ? `, ${s.errors} errors` : ''}`;
    batchRedeem.updatedAt = datetime();
    try { await batchRedeem.context.close(); } catch {}
    batchRedeem.context = null;
    batchRedeem.page = null;
    console.log(`[${datetime()}] Batch redeem ${batchRedeem.phase}: ${batchRedeem.message}`);
  }
}

async function startBatchRedeem() {
  const busy = browserBusy({ allowActiveBrowser: true });
  if (busy) throw new Error(`Cannot start batch redeem — ${busy}.`);
  if (activeBrowser) await closeBrowser();

  const pgDb = await jsonDb('prime-gaming.json', {});
  const pending = collectPendingGogCodes(pgDb);
  if (!pending.length) throw new Error('No pending GOG codes to redeem.');

  console.log(`[${datetime()}] Starting batch redeem for ${pending.length} GOG code(s)...`);
  const context = await launchContext(cfg.dir.browser, {
    headless: false,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble'],
  });
  const page = context.pages()[0] || await context.newPage();
  try { await page.setViewportSize({ width: cfg.width, height: cfg.height }); } catch {}
  context.setDefaultTimeout(0); // batch-redeem drives its own timeouts

  batchRedeem = {
    context, page, pgDb, pending,
    index: 0,
    stats: { redeemed: 0, used: 0, notFound: 0, unknown: 0, errors: 0, timeouts: 0 },
    phase: 'running',
    currentTitle: null, currentCode: null,
    message: `Starting — ${pending.length} code(s) queued`,
    startedAt: datetime(), updatedAt: datetime(),
  };

  runBatchRedeemLoop().catch(e => {
    console.error(`[${datetime()}] Batch redeem loop crashed:`, e);
    if (batchRedeem) {
      batchRedeem.phase = 'error';
      batchRedeem.message = `Error: ${e.message}`;
    }
  });

  return { success: true, total: pending.length };
}

async function stopBatchRedeem() {
  if (!batchRedeem) return { success: false, error: 'No batch redeem active.' };
  batchRedeem.phase = 'stopped';
  batchRedeem.message = 'Stopped by user';
  batchRedeem.updatedAt = datetime();
  try { if (batchRedeem.context) await batchRedeem.context.close(); } catch {}
  return { success: true, stats: batchRedeem.stats };
}

function clearFinishedBatchRedeem() {
  if (batchRedeem && (batchRedeem.phase === 'done' || batchRedeem.phase === 'stopped' || batchRedeem.phase === 'error')) {
    batchRedeem = null;
  }
}

async function checkAllSites() {
  const results = {};
  const active = activeServices();
  for (const siteId of Object.keys(SITES)) {
    if (!active.has(siteId)) continue; // skip deactivated services
    if (activeBrowser) {
      results[siteId] = { error: 'Browser session active, close it first.' };
      continue;
    }
    results[siteId] = await checkSiteStatus(siteId);
  }
  return results;
}

function runAllScripts({ source = 'panel', sites = null, extraEnv = {} } = {}) {
  const busy = browserBusy();
  if (busy) return { success: false, error: `Cannot start run — ${busy}.` };

  runLog = [];
  runStatus = 'running';
  runSource = sites ? source + ':' + sites.join('+') : source;
  runStartedAt = Date.now();
  const label = sites ? sites.join('+') : 'all';
  console.log(`[${datetime()}] Starting claim scripts (${source}/${label})...`);

  // For scheduled runs, set NOWAIT=1 so scripts exit fast on stale sessions
  // instead of waiting for interactive login. We follow up with a session
  // re-check to notify the user about any sites that now need manual action.
  const childEnv = source === 'scheduler'
    ? { ...process.env, NOWAIT: '1', ...extraEnv }
    : { ...process.env, ...extraEnv };
  // Single-service / explicit Run bypasses the MS internal window so a test
  // click at 3 PM doesn't sleep 17 hours until the 8 AM window opens.
  // Can't just set MS_SCHEDULE_HOURS=0 here — the in-app config layer
  // (data/config.json) overrides env, so if the user has saved a value via
  // Settings the env change is ignored. MS_SKIP_WINDOW is read by
  // microsoft.js directly, outside the cfg-merge path, so it always wins.
  if (sites && (sites.includes('microsoft') || sites.includes('microsoft-mobile'))) {
    childEnv.MS_SKIP_WINDOW = '1';
  }

  // Manual "Run Now" uses the subset without microsoft.js so it actually ends.
  // Both paths build dynamically from the current active-service set so
  // deactivating a site takes effect on the next run without a restart.
  const cmd = resolveClaimCommand({ manual: source !== 'scheduler', sites });
  if (!cmd) {
    console.log(`[${datetime()}] Run (${source}): no matching services — skipping.`);
    runStatus = 'idle';
    return { success: false, error: sites
      ? 'Service "' + sites.join(', ') + '" not recognized or inactive.'
      : 'No active services configured. Enable at least one in Settings → Services.' };
  }

  const child = spawn('bash', ['-c', cmd], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runProcess = child;

  const svcResults = {}; // id → exit code, filled by SVCRESULT: markers in stdout

  runDone = new Promise(resolve => {
    child.stdout.on('data', data => {
      process.stdout.write(data); // keep `docker logs` useful
      const text = data.toString();
      // Per-service exit code markers injected by buildClaimCommand
      for (const m of text.matchAll(/SVCRESULT:(\S+?):(\d+)/g)) {
        svcResults[m[1]] = parseInt(m[2]);
      }
      // Captcha markers from src/util.js#awaitUserCaptchaSolve. Parsed here
      // (not in the per-line forEach below) so multi-line buffers still match.
      const startMatch = text.match(/\[CAPTCHA-START\] service=(\S+)\s+label=(.*?)(?:\r?\n|$)/);
      if (startMatch) {
        captchaPending = { service: startMatch[1], label: startMatch[2].trim(), since: datetime() };
      }
      const endMatch = text.match(/\[CAPTCHA-END\] service=(\S+)/);
      if (endMatch && captchaPending && captchaPending.service === endMatch[1]) {
        captchaPending = null;
      }
      const lines = text.split('\n').filter(l => l.length);
      lines.forEach(l => {
        runLog.push({ type: 'stdout', text: l, time: datetime() });
        if (runLog.length > 500) runLog.shift();
      });
    });

    child.stderr.on('data', data => {
      process.stderr.write(data);
      const lines = data.toString().split('\n').filter(l => l.length);
      lines.forEach(l => {
        runLog.push({ type: 'stderr', text: l, time: datetime() });
        if (runLog.length > 500) runLog.shift();
      });
    });

    child.on('close', code => {
      // Update circuit breaker per service based on exit codes captured from stdout
      for (const [svcId, exitCode] of Object.entries(svcResults)) {
        const s = cb.readState();
        if (exitCode === 0) {
          const wasOpen = !!s[svcId]?.openUntil;
          cb.recordSuccess(svcId, s);
          if (wasOpen) notify(`${svcId}: circuit breaker closed — service recovered`).catch(() => {});
        } else {
          const wasClosed = !s[svcId]?.openUntil;
          cb.recordFailure(svcId, s, cfg.circuit_breaker_threshold, cfg.circuit_breaker_cooldown_hours);
          const s2 = cb.readState();
          if (wasClosed && s2[svcId]?.openUntil) {
            notify(`Circuit breaker opened for ${svcId} after ${s2[svcId].failures} failures — skipping for ${cfg.circuit_breaker_cooldown_hours}h`).catch(() => {});
          }
        }
      }
      runStatus = code === 0 ? 'success' : 'finished';
      runLog.push({ type: 'system', text: `Scripts finished with exit code ${code}`, time: datetime() });
      lastRun = {
        at: datetime(),
        source: runSource,
        exitCode: code,
        status: runStatus,
        durationSec: runStartedAt ? Math.round((Date.now() - runStartedAt) / 1000) : null,
      };
      runProcess = null;
      runSource = null;
      runStartedAt = null;
      captchaPending = null; // safety-net in case END marker was missed
      console.log(`[${datetime()}] All scripts finished (exit code ${code}).`);
      resolve(code);
    });

    child.on('error', err => {
      runStatus = 'error';
      runLog.push({ type: 'system', text: `Error: ${err.message}`, time: datetime() });
      lastRun = {
        at: datetime(),
        source: runSource,
        exitCode: -1,
        status: 'error',
        durationSec: runStartedAt ? Math.round((Date.now() - runStartedAt) / 1000) : null,
        error: err.message,
      };
      runProcess = null;
      runSource = null;
      runStartedAt = null;
      captchaPending = null;
      resolve(-1);
    });
  });

  return { success: true };
}

// ----- Scheduler -----
// Reads LOOP (seconds) and optional MS_SCHEDULE_HOURS / MS_SCHEDULE_START (hours) from env.
// Anchor-based wake time: if MS_SCHEDULE_HOURS is set we wake 30min before the window opens
// tomorrow, so the loop fires at ~the same clock time every day (no drift from run duration).
// Otherwise we sleep LOOP seconds after the previous run completes.
// Scheduler constants come from cfg (which merges data/config.json on top of
// env). This way the Settings tab's scheduler section takes effect at the
// next panel restart without rebuilding the container. Changes without a
// restart will land once the Phase 4 fs.watch hot-reload is in place.
const LOOP_SECONDS = cfg.loop;
const MS_SCHEDULE_HOURS = cfg.ms_schedule_hours;
const MS_SCHEDULE_START = cfg.ms_schedule_start;

let nextScheduledRun = null; // Date | null

function computeNextWakeMs() {
  const c = getSchedulerConfig();
  if (c.msHours > 0) {
    const wakeHour = c.msStart > 0 ? c.msStart - 1 : 23;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(wakeHour, 30, 0, 0);
    return Math.max(tomorrow.getTime() - Date.now(), 60 * 1000);
  }
  return c.loop * 1000;
}

// Set by watchConfigForScheduler() on save — lets the scheduler abandon
// its current sleep and recompute with the new interval immediately.
let schedulerWakeup = null;

// Cancellable sleep: resolves normally after ms, or early with 'reload' if
// schedulerWakeup() is invoked (by the config-file watcher).
function sleepUntilWakeup(ms) {
  return new Promise(resolve => {
    const t = setTimeout(() => { schedulerWakeup = null; resolve('tick'); }, ms);
    schedulerWakeup = () => { clearTimeout(t); schedulerWakeup = null; resolve('reload'); };
  });
}

function watchConfigForScheduler() {
  const dir = path.dirname(CONFIG_FILE_PATH);
  const base = path.basename(CONFIG_FILE_PATH);
  let debounce = null;
  try {
    // Watch the parent dir so we're robust to config.json being created
    // (first PUT), deleted (revert everything), or replaced via rename
    // (atomic write from patchConfig).
    watch(dir, { persistent: false }, (eventType, filename) => {
      if (filename !== base) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        console.log(`[${datetime()}] Scheduler: config changed — recomputing next wake.`);
        if (schedulerWakeup) schedulerWakeup();
      }, 150);
    });
  } catch (e) {
    console.error(`[${datetime()}] Scheduler: fs.watch setup failed (${e.message}). Config changes will need a restart to apply.`);
  }
}

async function postRunSessionCheck() {
  // After a scheduled run, probe each site. Any that come back not-logged-in
  // get a single aggregated Pushover notification with per-site deep-links
  // (?login=<siteId>) so tapping the right line lands the user directly in
  // that site's Login flow instead of the dashboard root.
  console.log(`[${datetime()}] Scheduler: verifying session health...`);
  const results = await checkAllSites();
  const stale = [];
  for (const [siteId, r] of Object.entries(results)) {
    if (!r || r.error) continue;
    if (r.loggedIn === false) stale.push(siteId);
  }
  if (!stale.length) {
    console.log(`[${datetime()}] Scheduler: all sessions valid.`);
    return;
  }
  const names = stale.map(id => SITES[id]?.name || id);
  console.log(`[${datetime()}] Scheduler: stale sessions detected — ${names.join(', ')}.`);
  // Plain-text body; Pushover strips HTML but auto-linkifies full URLs, so
  // we put one URL per line per site and keep the text on separate lines.
  const plural = stale.length > 1 ? 's' : '';
  const lines = [`Free Games Claimer — ${stale.length} session${plural} expired. Tap to log in:`];
  for (const siteId of stale) {
    const name = SITES[siteId]?.name || siteId;
    lines.push(`- ${name}: ${PUBLIC_URL}/?login=${encodeURIComponent(siteId)}`);
  }
  const body = lines.join('<br>');
  try {
    await notify(body);
  } catch (e) {
    console.error(`[${datetime()}] Scheduler: notify failed:`, e.message);
  }
}

async function schedulerLoop() {
  // Wait for the first computed wake time BEFORE running — otherwise a mid-day
  // container restart fires an immediate claim run, and if MS_SCHEDULE_HOURS is
  // set microsoft.js will sleep internally for up to 20 hours keeping runProcess
  // non-null and locking the panel. Users who want an immediate run can click
  // "Run Now" in the panel (matches how cron, systemd timers, etc. behave).
  while (true) {
    const sleepMs = computeNextWakeMs();
    if (sleepMs <= 0) {
      // Scheduler disabled (LOOP=0 and MS_SCHEDULE_HOURS=0). Park indefinitely
      // and let a config change unstick us.
      nextScheduledRun = null;
      console.log(`[${datetime()}] Scheduler: disabled — waiting for config change.`);
      await sleepUntilWakeup(2 ** 31 - 1);
      continue;
    }
    nextScheduledRun = new Date(Date.now() + sleepMs);
    console.log(`[${datetime()}] Scheduler: next run at ${datetime(nextScheduledRun)}.`);
    const how = await sleepUntilWakeup(sleepMs);
    if (how === 'reload') {
      // Config changed mid-sleep — skip the run, recompute.
      continue;
    }

    const busy = browserBusy();
    if (busy) {
      console.log(`[${datetime()}] Scheduler: skipping run — ${busy}.`);
      continue;
    }
    const accounts = getEffectiveAccounts();
    for (const account of accounts) {
      if (accounts.length > 1) console.log(`[${datetime()}] Scheduler: running account "${account.label}" (${account.id})...`);
      const extraEnv = { ...account.env };
      if (account.browserDir) extraEnv.BROWSER_DIR = account.browserDir;
      const accountSites = account.services?.length ? account.services : null;
      const res = runAllScripts({ source: 'scheduler', sites: accountSites, extraEnv });
      if (res.success && runDone) {
        try { await runDone; } catch (e) { console.error(`[${datetime()}] Scheduler run error:`, e); }
      } else if (!res.success) {
        console.log(`[${datetime()}] Scheduler: ${res.error}`);
      }
    }
    // Run finished — check which sessions survived and notify about stale ones.
    try { await postRunSessionCheck(); } catch (e) { console.error(`[${datetime()}] Session check failed:`, e); }
  }
}

function getState() {
  const active = activeServices();
  // allLoggedIn counts only services the user opted into — an inactive
  // service can't invalidate the "All sessions OK" summary strip.
  const allLoggedIn = Object.entries(siteStatus)
    .filter(([id]) => active.has(id))
    .every(([, s]) => s.status === 'logged_in');
  return {
    sites: Object.entries(SITES).map(([id, site]) => ({
      id,
      name: site.name,
      active: active.has(id),
      ...siteStatus[id],
    })),
    activeBrowser: activeBrowser ? { site: activeBrowser.siteId, name: SITES[activeBrowser.siteId].name } : null,
    allLoggedIn,
    runStatus,
    runSource,
    runLogLength: runLog.length,
    nextScheduledRun: nextScheduledRun ? datetime(nextScheduledRun) : null,
    loopEnabled: (() => { const c = getSchedulerConfig(); return c.loop > 0 || c.msHours > 0; })(),
    loopSeconds: getSchedulerConfig().loop,
    msScheduleHours: getSchedulerConfig().msHours,
    msScheduleStart: getSchedulerConfig().msStart,
    batchRedeem: batchRedeem ? {
      phase: batchRedeem.phase,
      message: batchRedeem.message,
      index: batchRedeem.index,
      total: batchRedeem.pending.length,
      currentTitle: batchRedeem.currentTitle,
      stats: batchRedeem.stats,
      startedAt: batchRedeem.startedAt,
      updatedAt: batchRedeem.updatedAt,
    } : null,
    startupAutoCheck,
    lastRun,
    captchaPending,
  };
}

// ----- Stats -----
// Aggregates claim history from per-service JSON DBs written by the claim
// scripts. Scripts set entry.status starting with "claimed" (plain,
// "claimed and redeemed", "claimed on gog.com", etc.) once a claim succeeds;
// anything else (existed/failed/skipped) is excluded from game counts.
// Microsoft Rewards is points-based and has no claim DB, so it appears in
// the per-service table as N/A.

const CLAIM_DB_FILES = {
  'prime-gaming': 'prime-gaming.json',
  'epic-games': 'epic-games.json',
  'gog': 'gog.json',
  'steam': 'steam.json',
};

function parseLocalDateTime(s) {
  if (typeof s !== 'string' || !s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isFinite(d.getTime()) ? d : null;
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function readAllClaims() {
  const out = [];
  for (const [service, file] of Object.entries(CLAIM_DB_FILES)) {
    let db;
    try { db = await jsonDb(file, {}); }
    catch { continue; }
    const data = db.data || {};
    for (const user of Object.keys(data)) {
      const userRecords = data[user];
      if (!userRecords || typeof userRecords !== 'object') continue;
      for (const [gameId, entry] of Object.entries(userRecords)) {
        if (!entry || typeof entry !== 'object') continue;
        const status = typeof entry.status === 'string' ? entry.status : '';
        if (!status.startsWith('claimed')) continue;
        const at = parseLocalDateTime(entry.time);
        if (!at) continue;
        out.push({ service, user, gameId, title: entry.title || gameId, url: entry.url || null, at, status });
      }
    }
  }
  return out;
}

// Aggregate MS Rewards point history captured by microsoft.js. Each run
// records { at, session, before, after, earned } in microsoft-rewards.json
// — we can derive: latest visible balance, points earned in a window,
// per-session counts for the stats table.
async function getMsRewards() {
  let db;
  try { db = await jsonDb('microsoft-rewards.json', { runs: [] }); }
  catch { return { latestBalance: null, latestAt: null, weekEarned: 0, monthEarned: 0, bySession: {} }; }
  const runs = (db.data && Array.isArray(db.data.runs)) ? db.data.runs : [];
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const toMs = s => { const d = parseLocalDateTime(s); return d ? d.getTime() : 0; };
  let weekEarned = 0, monthEarned = 0;
  let latestBalance = null, latestAt = null, latestMs = 0;
  const bySession = {
    'microsoft':        { thisWeek: 0, thisMonth: 0, allTime: 0, lastClaimAt: null, unit: 'points' },
    'microsoft-mobile': { thisWeek: 0, thisMonth: 0, allTime: 0, lastClaimAt: null, unit: 'points' },
  };
  for (const r of runs) {
    const tMs = toMs(r.at);
    const earned = Number.isFinite(r.earned) ? Math.max(0, r.earned) : 0;
    if (tMs >= weekAgo) weekEarned += earned;
    if (tMs >= monthAgo) monthEarned += earned;
    if (r.after != null && tMs >= latestMs) { latestBalance = r.after; latestAt = r.at; latestMs = tMs; }
    const sKey = r.session === 'mobile' ? 'microsoft-mobile' : 'microsoft';
    const row = bySession[sKey];
    row.allTime += earned;
    if (tMs >= weekAgo) row.thisWeek += earned;
    if (tMs >= monthAgo) row.thisMonth += earned;
    if (!row.lastClaimAt || tMs > toMs(row.lastClaimAt)) row.lastClaimAt = r.at;
  }
  return { latestBalance, latestAt, weekEarned, monthEarned, bySession };
}

// AliExpress tracks a daily coin balance in data/aliexpress.json (written by
// aliexpress.js). Similar shape to MS Rewards — we surface the latest balance
// and per-window "earned" totals in the Stats tab.
async function getAliexpressData() {
  let db;
  try { db = await jsonDb('aliexpress.json', { runs: [] }); }
  catch { return { latestBalance: null, latestAt: null, weekEarned: 0, monthEarned: 0, row: null }; }
  const runs = (db.data && Array.isArray(db.data.runs)) ? db.data.runs : [];
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const toMs = s => { const d = parseLocalDateTime(s); return d ? d.getTime() : 0; };
  let latestBalance = null, latestAt = null, latestMs = 0;
  let weekEarned = 0, monthEarned = 0, allTimeEarned = 0;
  for (const r of runs) {
    const tMs = toMs(r.at);
    const earned = Number.isFinite(r.earned) ? Math.max(0, r.earned) : 0;
    allTimeEarned += earned;
    if (tMs >= weekAgo)  weekEarned  += earned;
    if (tMs >= monthAgo) monthEarned += earned;
    if (r.balance != null && tMs >= latestMs) { latestBalance = r.balance; latestAt = r.at; latestMs = tMs; }
  }
  const row = runs.length
    ? { thisWeek: weekEarned, thisMonth: monthEarned, allTime: allTimeEarned, lastClaimAt: latestAt, unit: 'coins' }
    : null;
  return { latestBalance, latestAt, weekEarned, monthEarned, row };
}

async function getStatsSummary() {
  const [claims, ms] = await Promise.all([readAllClaims(), getMsRewards()]);
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const thisWeek = claims.filter(c => c.at.getTime() >= weekAgo).length;
  const thisMonth = claims.filter(c => c.at.getTime() >= monthAgo).length;
  claims.sort((a, b) => b.at - a.at);
  const latest = claims[0] || null;
  return {
    gamesThisWeek: thisWeek,
    gamesThisMonth: thisMonth,
    gamesAllTime: claims.length,
    lastClaim: latest ? {
      at: datetime(latest.at),
      service: latest.service,
      serviceName: (SITES[latest.service] && SITES[latest.service].name) || latest.service,
      title: latest.title,
      url: latest.url,
    } : null,
    msPointsBalance: ms.latestBalance,
    msPointsBalanceAt: ms.latestAt,
    msPointsThisWeek: ms.weekEarned,
    msPointsThisMonth: ms.monthEarned,
  };
}

async function getStatsByService() {
  const [claims, ms, ae] = await Promise.all([readAllClaims(), getMsRewards(), getAliexpressData()]);
  const rows = {};
  for (const svc of Object.keys(CLAIM_DB_FILES)) {
    rows[svc] = { id: svc, unit: 'games', thisWeek: 0, thisMonth: 0, allTime: 0, lastClaimAt: null };
  }
  // MS rows use real aggregates from the MS runs DB instead of the "N/A" stub.
  rows['microsoft']        = { id: 'microsoft',        ...ms.bySession['microsoft'] };
  rows['microsoft-mobile'] = { id: 'microsoft-mobile', ...ms.bySession['microsoft-mobile'] };
  if (ae.row) {
    rows['aliexpress'] = { id: 'aliexpress', ...ae.row };
  }
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  for (const c of claims) {
    const row = rows[c.service];
    if (!row || row.unit !== 'games') continue;
    row.allTime++;
    if (c.at.getTime() >= weekAgo) row.thisWeek++;
    if (c.at.getTime() >= monthAgo) row.thisMonth++;
    const ts = datetime(c.at);
    if (!row.lastClaimAt || ts > row.lastClaimAt) row.lastClaimAt = ts;
  }
  return Object.values(rows).map(r => ({
    ...r,
    name: (SITES[r.id] && SITES[r.id].name) || r.id,
  }));
}

async function getStatsDaily(days = 30) {
  const claims = await readAllClaims();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ date: localDateKey(d), count: 0, items: [] });
  }
  const byDate = Object.fromEntries(buckets.map(b => [b.date, b]));
  for (const c of claims) {
    const key = localDateKey(c.at);
    if (!byDate[key]) continue;
    byDate[key].count++;
    byDate[key].items.push({
      service: c.service,
      serviceName: (SITES[c.service] && SITES[c.service].name) || c.service,
      title: c.title,
    });
  }
  return buckets;
}

async function getActivity(limit = 10) {
  const claims = await readAllClaims();
  claims.sort((a, b) => b.at - a.at);
  return claims.slice(0, limit).map(c => ({
    at: datetime(c.at),
    service: c.service,
    serviceName: (SITES[c.service] && SITES[c.service].name) || c.service,
    title: c.title,
    url: c.url,
    status: c.status,
  }));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}


checkFilePermissions(ACCOUNTS_FILE, 'data/accounts.json');
checkFilePermissions(dataDir('config.env'), 'data/config.env');

const server = http.createServer(async (req, res) => {
  try {
    // Strip BASE_PATH prefix if present so existing route matchers keep working for both
    // direct access (http://host:7080/...) and subfolder-proxied access (https://host/base/...).
    if (BASE_PATH && (req.url === BASE_PATH || req.url.startsWith(BASE_PATH + '/') || req.url.startsWith(BASE_PATH + '?'))) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }

    if (req.method === 'POST' && req.url === '/api/auth') {
      const { password } = await parseBody(req);
      if (password === PANEL_PASSWORD) {
        const token = generateToken();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `fgc_token=${token}; Path=/; HttpOnly; SameSite=Strict` });
        res.end(JSON.stringify({ success: true }));
      } else {
        sendJson(res, { success: false }, 401);
      }
      return;
    }

    if (!isAuthenticated(req)) {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(LOGIN_HTML);
        return;
      }
      sendJson(res, { error: 'Unauthorized' }, 401);
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(PANEL_HTML);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/state') {
      sendJson(res, getState());
      return;
    }

    if (req.method === 'POST' && req.url === '/api/launch') {
      const { site } = await parseBody(req);
      if (!site || !SITES[site]) {
        sendJson(res, { success: false, error: 'Invalid site.' }, 400);
        return;
      }
      try {
        const result = await launchSite(site);
        sendJson(res, result);
      } catch (e) {
        sendJson(res, { success: false, error: e.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/verify') {
      const result = await verifyAndClose();
      sendJson(res, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/close') {
      await closeBrowser();
      sendJson(res, { success: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/check') {
      const { site } = await parseBody(req);
      if (!site || !SITES[site]) {
        sendJson(res, { error: 'Invalid site.' }, 400);
        return;
      }
      invalidateSession(site); // user explicitly requested a fresh check
      const result = await checkSiteStatus(site);
      sendJson(res, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/check-all') {
      Object.keys(SITES).forEach(id => invalidateSession(id)); // fresh check for all
      const results = await checkAllSites();
      sendJson(res, results);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/run-all') {
      const result = runAllScripts({ source: 'panel' });
      sendJson(res, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/run-service') {
      try {
        const body = await parseBody(req);
        const site = body && body.site;
        if (!site || typeof site !== 'string') {
          sendJson(res, { success: false, error: 'site required (e.g. {"site": "microsoft"})' }, 400);
          return;
        }
        // microsoft and microsoft-mobile are both served by microsoft.js;
        // passing either ID runs the shared script once.
        const result = runAllScripts({ source: 'panel', sites: [site] });
        sendJson(res, result);
      } catch (e) {
        sendJson(res, { success: false, error: e.message }, 400);
      }
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/run-log')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const since = parseInt(url.searchParams.get('since') || '0', 10);
      sendJson(res, { lines: runLog.slice(since), total: runLog.length, status: runStatus });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/notifications/test') {
      // Use describeConfig rather than cfg.* so the test picks up whatever is
      // currently in data/config.json — cfg was baked at process boot and
      // won't see post-boot edits without a restart.
      const { effective } = describeConfig();
      const url = effective.notifications && effective.notifications.notify;
      const title = (effective.notifications && effective.notifications.notifyTitle) || 'Free Games Claimer';
      if (!url) { sendJson(res, { ok: false, error: 'No NOTIFY URL configured' }, 400); return; }
      const html = '<p>Test notification from Free Games Claimer panel at ' + datetime() + '.</p>';
      const args = [url, '-i', 'html', '-t', title + ' — test', '-b', html];
      execFile('apprise', args, (err, stdout, stderr) => {
        if (err) { sendJson(res, { ok: false, error: stderr || err.message }, 500); return; }
        sendJson(res, { ok: true });
      });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/library')) {
      const p = new URL(req.url, `http://localhost`).searchParams;
      const result = readLibrary({
        platform: p.get('platform') || undefined,
        status:   p.get('status')   || undefined,
        q:        p.get('q')        || undefined,
      });
      sendJson(res, result);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/accounts') {
      if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
      sendJson(res, readAccounts().map(maskAccountCredentials));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/accounts') {
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

    if (req.url.startsWith('/api/accounts/') && req.method === 'DELETE') {
      if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
      const id = decodeURIComponent(req.url.slice('/api/accounts/'.length));
      writeAccounts(readAccounts().filter(a => a.id !== id));
      sendJson(res, { ok: true });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/config') {
      sendJson(res, describeConfig());
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/env')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const reveal = url.searchParams.get('reveal') === '1';
      sendJson(res, { env: describeEnv({ reveal }) });
      return;
    }
    if (req.method === 'PUT' && req.url === '/api/config') {
      try {
        const body = await parseBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, { error: 'body must be a JSON object of path→value (value=null removes override)' }, 400);
          return;
        }
        const { errors } = patchConfig(body);
        if (errors.length) { sendJson(res, { errors }, 400); return; }
        // Return the fresh merged view so clients can replace their in-memory
        // state with a single response.
        sendJson(res, describeConfig());
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/api/stats/summary') {
      sendJson(res, await getStatsSummary());
      return;
    }
    if (req.method === 'GET' && req.url === '/api/stats/by-service') {
      sendJson(res, await getStatsByService());
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/stats/daily')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)));
      sendJson(res, await getStatsDaily(days));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/activity')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));
      sendJson(res, await getActivity(limit));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/stop-run') {
      if (runProcess) {
        runProcess.kill('SIGTERM');
        runLog.push({ type: 'system', text: 'Scripts stopped by user.', time: datetime() });
        runStatus = 'stopped';
        runProcess = null;
        captchaPending = null;
        sendJson(res, { success: true });
      } else {
        sendJson(res, { success: false, error: 'No scripts are running.' });
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/api/pending-gog-count') {
      const count = await countPendingGogCodes();
      sendJson(res, { count });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/batch-redeem/start') {
      try {
        const result = await startBatchRedeem();
        sendJson(res, result);
      } catch (e) {
        sendJson(res, { success: false, error: e.message }, 400);
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/batch-redeem/stop') {
      const result = await stopBatchRedeem();
      sendJson(res, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/batch-redeem/clear') {
      clearFinishedBatchRedeem();
      sendJson(res, { success: true });
      return;
    }

    // Static asset serving — branding (logo + favicon set). Path-allowlisted
    // to /assets/ + /favicon.ico to avoid traversal; we never serve arbitrary
    // files. Browser tab favicon hits /favicon.ico without the prefix on
    // some browsers, so we map both.
    if (req.method === 'GET') {
      let assetPath = null;
      if (req.url === '/favicon.ico') assetPath = 'favicon.ico';
      else if (req.url.startsWith('/assets/')) {
        const rel = req.url.slice('/assets/'.length).split('?')[0];
        if (rel && !rel.includes('..') && !rel.includes('/')) assetPath = rel;
      }
      if (assetPath) {
        const full = path.join(__panelDirname, 'assets', assetPath);
        if (existsSync(full)) {
          const ext = path.extname(assetPath).toLowerCase();
          const ct = { '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' });
          res.end(readFileSync(full));
          return;
        }
      }
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    console.error(`[${datetime()}] Server error:`, e);
    sendJson(res, { error: e.message }, 500);
  }
});

async function gracefulShutdown(sig) {
  console.log(`[${datetime()}] Received ${sig}, shutting down...`);
  if (runProcess) {
    try { runProcess.kill('SIGTERM'); } catch {}
  }
  if (batchRedeem) {
    batchRedeem.phase = 'stopped';
    try { if (batchRedeem.context) await batchRedeem.context.close(); } catch {}
  }
  await closeBrowser();
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(PANEL_PORT, async () => {
  console.log(`[${datetime()}] Free Games Claimer ${APP_VERSION ? 'v' + APP_VERSION + ' ' : ''}— panel + scheduler`);
  console.log(`[${datetime()}] Control panel: http://localhost:${PANEL_PORT}${BASE_PATH}`);
  if (cfg.public_url) console.log(`[${datetime()}] Public URL:    ${PUBLIC_URL}`);
  console.log(`[${datetime()}] noVNC viewer:  http://localhost:${NOVNC_PORT}${BASE_PATH ? ` (proxied at ${BASE_PATH}/novnc/)` : ''}`);
  console.log(`[${datetime()}] Password protection: ${PANEL_PASSWORD ? 'ENABLED' : 'DISABLED (set PANEL_PASSWORD or VNC_PASSWORD to enable)'}`);
  if (LOOP_SECONDS > 0 || MS_SCHEDULE_HOURS > 0) {
    const desc = MS_SCHEDULE_HOURS > 0 ? `anchored to MS window start ${MS_SCHEDULE_START}:00` : `every ${LOOP_SECONDS}s`;
    console.log(`[${datetime()}] Scheduler: enabled (${desc})`);
  } else {
    console.log(`[${datetime()}] Scheduler: disabled (set LOOP or MS_SCHEDULE_HOURS to enable)`);
  }
  if (cfg.notify && !cfg.public_url) {
    console.log(`[${datetime()}] ⚠  NOTIFY is set but PUBLIC_URL is not — notification tap-targets will point to http://localhost:${PANEL_PORT}${BASE_PATH} which won't work from a mobile device. Set PUBLIC_URL to the externally-reachable panel URL.`);
  }
  console.log(`[${datetime()}] Open the control panel URL in your browser.`);
  console.log(`[${datetime()}] Auto-checking all sessions...`);
  const active = activeServices();
  const siteIds = Object.keys(SITES).filter(id => active.has(id));
  startupAutoCheck = { current: 0, total: siteIds.length, siteName: '' };
  for (const siteId of siteIds) {
    startupAutoCheck.siteName = SITES[siteId].name;
    await checkSiteStatus(siteId);
    startupAutoCheck.current++;
  }
  startupAutoCheck = null;
  console.log(`[${datetime()}] Auto-check complete (${siteIds.length} active, ${Object.keys(SITES).length - siteIds.length} skipped).`);

  // Kick off the scheduler after session auto-check so first run sees fresh
  // status. The loop always starts — when both LOOP and MS_SCHEDULE_HOURS
  // resolve to 0 it parks in sleepUntilWakeup and wakes on config change via
  // watchConfigForScheduler().
  schedulerLoop().catch(err => {
    console.error(`[${datetime()}] Scheduler crashed:`, err);
  });
  watchConfigForScheduler();
});
