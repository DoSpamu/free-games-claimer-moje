// https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
import path from 'node:path';
// patchright loaded lazily inside launchBrowser so test environments without the package can still import this module
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { FingerprintGenerator } = _require('fingerprint-generator');
const { FingerprintInjector } = _require('fingerprint-injector');
const _fingerprintGenerator = new FingerprintGenerator({ browsers: [{ name: 'chrome', minVersion: 130 }], devices: ['desktop'], operatingSystems: ['windows'] });
const _fingerprintInjector = new FingerprintInjector();

// Load a persistent fingerprint from disk, generating it once on first run.
// A real user always appears as the same "computer" - same canvas hash, WebGL renderer, fonts, etc.
// Regenerating every run is more suspicious than a stable identity.
// Delete data/fingerprint.json to force a new fingerprint (e.g. after changing WIDTH/HEIGHT).
export const generateFingerprint = (width = 1920, height = 1080) => {
  const fpFile = dataDir('fingerprint.json');
  if (existsSync(fpFile)) {
    try {
      return JSON.parse(_require('node:fs').readFileSync(fpFile, 'utf8'));
    } catch (_) { /* corrupted file - regenerate */ }
  }
  let fp;
  try {
    fp = _fingerprintGenerator.getFingerprint({ screen: { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height } });
  } catch (_) {
    fp = _fingerprintGenerator.getFingerprint();
  }
  try {
    writeFileSync(fpFile, JSON.stringify(fp, null, 2));
    console.log('Generated new browser fingerprint, saved to', fpFile);
  } catch (_) { /* non-critical */ }
  return fp;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const dataDir = s => path.resolve(__dirname, '..', 'data', s);

// Remove stale browser profile lock left behind by a crashed/killed previous run.
// Firefox uses parent.lock, Chromium/patchright uses SingletonLock.
export const clearBrowserLock = (dir) => {
  for (const lockName of ['parent.lock', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const lockFile = path.join(dir, lockName);
    if (existsSync(lockFile)) {
      try {
        unlinkSync(lockFile);
        console.log('Removed stale browser lock file:', lockFile);
      } catch (_) {
        console.error(`Browser profile is already in use: ${lockFile}`);
        console.error('Close other browser instances sharing this profile, or set a different BROWSER_DIR.');
        process.exit(1);
      }
    }
  }
};

// Write a lastrun timestamp so Docker HEALTHCHECK can verify the scheduler is alive.
export const writeLastRun = (script) => {
  try {
    const p = dataDir('lastrun.json');
    writeFileSync(p, JSON.stringify({ script, time: new Date().toISOString() }));
  } catch (_) { /* non-critical */ }
};

// modified path.resolve to return null if first argument is '0', used to disable screenshots
export const resolve = (...a) => a.length && a[0] == '0' ? null : path.resolve(...a);

// json database
import { JSONFilePreset } from 'lowdb/node';
export const jsonDb = (file, defaultData) => JSONFilePreset(dataDir(file), defaultData);

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// date and time as UTC (no timezone offset) in nicely readable and sortable format, e.g., 2022-10-06 12:05:27.313
export const datetimeUTC = (d = new Date()) => d.toISOString().replace('T', ' ').replace('Z', '');
// same as datetimeUTC() but for local timezone, e.g., UTC + 2h for the above in DE
export const datetime = (d = new Date()) => datetimeUTC(new Date(d.getTime() - d.getTimezoneOffset() * 60000));
export const filenamify = s => s.replaceAll(':', '.').replace(/[^a-z0-9 _\-.]/gi, '_'); // alternative: https://www.npmjs.com/package/filenamify - On Unix-like systems, / is reserved. On Windows, <>:"/\|?* along with trailing periods are reserved.

// Race context.close() with a timeout. Some sites (e.g. Epic Store) keep service workers and
// long-poll websockets alive, which withholds the renderer's close-ack and hangs context.close()
// indefinitely. Page-level finalization (video, HAR) has already flushed by the time we get here,
// so on timeout we warn and let the process exit.
export const closeContextSafely = async (context, timeoutMs = 15000) => {
  const closed = await Promise.race([
    context.close().then(() => true, () => true),
    new Promise(r => setTimeout(() => r(false), timeoutMs)),
  ]);
  if (!closed) console.warn(`context.close() timed out after ${timeoutMs}ms — forcing exit (likely a stuck service worker)`);
  return closed;
};

export const handleSIGINT = (context = null) => process.on('SIGINT', async () => { // e.g. when killed by Ctrl-C
  console.error('\nInterrupted by SIGINT. Exit!');
  process.exitCode = 130; // 128+SIGINT to indicate to parent that process was killed
  if (context) await closeContextSafely(context); // in order to save recordings also on SIGINT, we need to disable Playwright's handleSIGINT and close the context ourselves
  process.exit(process.exitCode);
});

// Retry wrapper - retries an async function on failure with delay between attempts.
export const withRetry = async (label, fn, { retries = 3, delayMs = 30000 } = {}) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= retries - 1) throw e;
      console.error(`${label}: attempt ${i + 1}/${retries} failed: ${e.message?.split('\n')[0]}`);
      console.log(`Retrying in ${delayMs / 1000}s...`);
      await delay(delayMs);
    }
  }
};

export const stealth = async (context, fingerprint = null) => {
  // stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
  // https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions
  const enabledEvasions = [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime', // partially broken in Chrome 100+, patched below
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.webdriver',
    'sourceurl',
    'webgl.vendor',
    'window.outerdimensions',
  ];
  const stealth = {
    callbacks: [],
    async evaluateOnNewDocument(...args) {
      this.callbacks.push({ cb: args[0], a: args[1] });
    },
  };
  for (const e of enabledEvasions) {
    const evasion = await import(`puppeteer-extra-plugin-stealth/evasions/${e}/index.js`);
    evasion.default().onPageCreated(stealth);
  }
  for (const evasion of stealth.callbacks) {
    await context.addInitScript(evasion.cb, evasion.a);
  }

  // fingerprint-injector: injects canvas fingerprint, WebGL renderer/vendor, font metrics,
  // navigator properties (hardwareConcurrency, deviceMemory, languages, plugins, etc.)
  // and sets matching sec-ch-ua / user-agent HTTP headers.
  if (fingerprint) {
    await _fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);
  }

  // chrome.runtime patch: puppeteer-extra-plugin-stealth's version is broken in Chrome 100+
  await context.addInitScript(() => {
    if (!window.chrome) return;
    if (window.chrome.runtime && window.chrome.runtime.PlatformOs) return; // already set correctly (non-headless real Chrome)
    try {
      Object.defineProperty(window.chrome, 'runtime', {
        value: {
          PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          connect: () => { throw new Error('Extension context invalidated.'); },
          sendMessage: () => { throw new Error('Extension context invalidated.'); },
          id: undefined,
        },
        writable: false,
        enumerable: false,
        configurable: false,
      });
    } catch (_) { /* already defined by real Chrome runtime - that's fine */ }
  });
};

// used prompts before, but couldn't cancel prompt
// alternative inquirer is big (node_modules 29MB, enquirer 9.7MB, prompts 9.8MB, none 9.4MB) and slower
// open issue: prevents handleSIGINT() to work if prompt is cancelled with Ctrl-C instead of Escape: https://github.com/enquirer/enquirer/issues/372
import Enquirer from 'enquirer'; const enquirer = new Enquirer();
const timeoutPlugin = timeout => enquirer => { // cancel prompt after timeout ms
  enquirer.on('prompt', prompt => {
    const t = setTimeout(() => {
      prompt.hint = () => 'timeout';
      prompt.cancel();
    }, timeout);
    prompt.on('submit', _ => clearTimeout(t));
    prompt.on('cancel', _ => clearTimeout(t));
  });
};
enquirer.use(timeoutPlugin(cfg.login_timeout)); // TODO may not want to have this timeout for all prompts; better extend Prompt and add a timeout prompt option
// single prompt that just returns the non-empty value instead of an object
// @ts-ignore
export const prompt = o => enquirer.prompt({ name: 'name', type: 'input', message: 'Enter value', ...o }).then(r => r.name).catch(_ => {});
export const confirm = o => prompt({ type: 'confirm', message: 'Continue?', ...o });

// notifications via apprise CLI (set NOTIFY env var)
import { execFile } from 'child_process';
import chalk from 'chalk';
import { cfg } from './config.js';

// Walk cfg.dir.screenshots recursively for the newest PNG with mtime >= this
// process's start time. Used by notify() when callers pass
// { attachLatestScreenshot: true } so error notifications carry the visual
// state of the failure without each call site needing to track a path.
const findLatestScreenshot = async () => {
  const root = cfg.dir?.screenshots;
  if (!root || root === '0') return null;
  const cutoff = Date.now() - process.uptime() * 1000;
  const walk = async dir => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return []; }
    const found = await Promise.all(entries.map(async e => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.png')) return [];
      const s = await fsp.stat(full).catch(() => null);
      return s && s.mtimeMs >= cutoff ? [{ path: full, mtime: s.mtimeMs }] : [];
    }));
    return found.flat();
  };
  const files = await walk(root);
  if (!files.length) return null;
  files.sort((a, b) => b.mtime - a.mtime);
  return files[0].path;
};

// Direct Telegram notification without Apprise (set TG_TOKEN and TG_CHAT_ID env vars).
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

export const notify = (html, opts = {}) => {
  const tgImage = opts.games?.length === 1 ? opts.games[0].imageUrl : undefined;
  notifyTelegram(html, { imageUrl: tgImage }).catch(() => {});
  notifyDiscord(opts.games || [], html).catch(() => {});
  if (!cfg.notify) {
    if (cfg.debug) console.debug('notify: NOTIFY is not set!');
    return Promise.resolve();
  }
  // Resolve attachment path (if any) before invoking apprise. Explicit
  // opts.screenshot always wins; attachLatestScreenshot is the autopilot
  // path and is gated by cfg.notify_attach_screenshots so users can opt
  // out of attachments globally (privacy / bandwidth / target limits).
  const wantLatest = opts.attachLatestScreenshot && cfg.notify_attach_screenshots !== false;
  const attachPromise = opts.screenshot
    ? Promise.resolve(opts.screenshot)
    : wantLatest
      ? findLatestScreenshot().catch(() => null)
      : Promise.resolve(null);
  return attachPromise.then(attachPath => new Promise((resolve, reject) => {
    const args = [cfg.notify, '-i', 'html', '-b', html];
    if (cfg.notify_title) args.push('-t', cfg.notify_title);
    if (attachPath) args.push('-a', attachPath);
    if (cfg.debug) console.debug(`apprise ${args.map(a => `'${a}'`).join(' ')}`);
    execFile('apprise', args, (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
        if (error.message.includes('command not found')) {
          console.info('Run `pip install apprise`. See https://github.com/vogler/free-games-claimer#notifications');
        }
        return reject(error);
      }
      if (stderr) console.error(`stderr: ${stderr}`);
      if (stdout) console.log(`stdout: ${stdout}`);
      resolve();
    });
  }));
};

export const escapeHtml = unsafe => unsafe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');

// Captcha pause helper. Per-service state machine in process memory drives
// whether the helper actively engages the user (notify + wait + poll) or
// short-circuits with a deferred-form push notification so the user can
// process the captcha manually later.
const _captchaServiceState = new Map(); // service -> 'engaged' | 'abandoned'
const _captchaDeepLink = () => cfg.public_url ? `${cfg.public_url}/?focus=captcha` : null;
const _captchaNotifyBody = (service, label, kind) => {
  const url = _captchaDeepLink();
  const intro = kind === 'urgent'
    ? `${escapeHtml(service)} captcha: ${escapeHtml(label)} — solve now`
    : `${escapeHtml(service)} captcha: ${escapeHtml(label)} — solve later when you can`;
  return url ? `${intro}<br>${url}` : `${intro}. Open the panel to solve.`;
};
export const awaitUserCaptchaSolve = async (page, {
  service,
  label = 'verification',
  captchaCheck,
  timeoutMs = 10 * 60 * 1000,
  pollMs = 1000,
}) => {
  if (!service) throw new Error('awaitUserCaptchaSolve: service is required');
  if (typeof captchaCheck !== 'function') throw new Error('awaitUserCaptchaSolve: captchaCheck function is required');

  // Skip the whole dance if the captcha isn't actually visible.
  if (!(await captchaCheck())) return true;

  const safeLabel = String(label).replace(/\s+/g, ' ').slice(0, 200);
  const state = _captchaServiceState.get(service); // undefined = fresh

  // Abandoned path — user gave up earlier. Single deferred notification so
  // they have a record + link, then return false without blocking.
  if (state === 'abandoned') {
    notify(_captchaNotifyBody(service, safeLabel, 'deferred'))
      .catch(e => console.error(`captcha notify (deferred) failed: ${e.message}`));
    return false;
  }

  // Engagement path — fresh or previously engaged. Banner + urgent notify + poll.
  console.log(`[CAPTCHA-START] service=${service} label=${safeLabel}`);
  notify(_captchaNotifyBody(service, safeLabel, 'urgent'))
    .catch(e => console.error(`captcha notify (urgent) failed: ${e.message}`));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollMs);
    let visible;
    try { visible = await captchaCheck(); }
    catch { visible = true; } // err on the side of waiting through transient errors
    if (!visible) {
      _captchaServiceState.set(service, 'engaged');
      console.log(`[CAPTCHA-END] service=${service} reason=solved`);
      return true;
    }
  }

  // Timed out — flip to abandoned, fire a deferred follow-up so this missed
  // captcha doesn't disappear from the user's awareness, return false.
  _captchaServiceState.set(service, 'abandoned');
  console.log(`[CAPTCHA-END] service=${service} reason=timeout`);
  notify(_captchaNotifyBody(service, safeLabel, 'deferred'))
    .catch(e => console.error(`captcha notify (deferred) failed: ${e.message}`));
  return false;
};

// Normalize a game title for fuzzy cross-store matching: lowercase, collapse
// separators/punctuation/whitespace. Used to reconcile Prime Gaming entries
// against the authenticated GOG library where exact punctuation / edition
// suffixes may differ between stores.
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

export const normalizeTitle = s => (s || '')
  .toLowerCase()
  .replace(/[:;\-–—_/\\]/g, ' ')
  .replace(/['".,!?()[\]®™©]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const html_game_list = games => games.map(g => {
  if (g.status === 'action') return `<b><a href="${g.url}">${escapeHtml(g.title)}</a></b>`;
  let line = `- <a href="${g.url}">${escapeHtml(g.title)}</a> (${g.status})`;
  if (g.details) line += `<br>  ${g.details}`;
  return line;
}).join('<br>');

const SECTION_WIDTH = 50;
export const log = {
  section: (title) => {
    const pad = SECTION_WIDTH - title.length - 5;
    console.log(`\n${'─'.repeat(3)} ${title} ${'─'.repeat(Math.max(3, pad))}`);
  },
  sectionEnd: () => {
    console.log('─'.repeat(SECTION_WIDTH));
  },
  status: (label, value) => {
    console.log(`  ${label}: ${value}`);
  },
  info: (msg) => {
    console.log(`  ${chalk.green('✓')} ${msg}`);
  },
  game: (name, status) => {
    console.log(`    ${chalk.blue(name)} ${chalk.dim('→')} ${status}`);
  },
  skip: (name, reason) => {
    console.log(`    ${chalk.red('✗')} ${chalk.dim(name)} — ${chalk.yellow(reason)}`);
  },
  ok: (msg) => {
    console.log(`    ${chalk.green('✓')} ${msg}`);
  },
  warn: (msg) => {
    console.log(`    ${chalk.yellow('!')} ${msg}`);
  },
  fail: (msg) => {
    console.log(`  ${chalk.red('✗')} ${msg}`);
  },
  summary: (parts) => {
    console.log(`  ${chalk.dim('Summary:')} ${parts.join(', ')}`);
  },
  // Progressive line helpers — write pieces without newline, then end the line.
  // Use these when you want log output to appear incrementally (e.g. during sleeps).
  progressStart: (msg) => process.stdout.write(`  ${msg}`),
  progressAppend: (msg) => process.stdout.write(msg),
  progressEnd: (msg = '') => process.stdout.write(`${msg}\n`),
  progressInfo: (msg) => process.stdout.write(`  ${chalk.green('✓')} ${msg}`),
};

export const launchBrowser = async (options = {}) => {
  const { browserDir, harPrefix, extraArgs = [], headless = cfg.headless, deviceOptions = {} } = options;
  if (process.env.BROWSER_TYPE === 'firefox') {
    const { firefox } = await import('playwright');
    return firefox.launchPersistentContext(browserDir ?? cfg.dir.browser, {
      headless,
      viewport: { width: cfg.width, height: cfg.height },
      locale: 'en-US',
      ...deviceOptions,
      handleSIGINT: false,
      firefoxUserPrefs: { 'dom.webdriver.enabled': false },
    });
  }
  const { chromium } = await import('patchright');
  const context = await chromium.launchPersistentContext(browserDir ?? cfg.dir.browser, {
    channel: 'chrome', // real Chrome binary — authentic TLS/HTTP2 fingerprint, no CDP artifacts
    headless,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    ...deviceOptions,
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
    recordHar: cfg.record && harPrefix ? { path: `data/record/${harPrefix}-${filenamify(datetime())}.har` } : undefined,
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble', ...extraArgs],
  });
  await stealth(context, generateFingerprint(cfg.width, cfg.height));
  return context;
};
