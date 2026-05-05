// Opt-in service — the panel's runner only invokes this script when
// services.aliexpress.active === true (Settings → Per-service → AliExpress).
// If you run it standalone on the CLI, it always executes; the activation
// gate lives in interactive-login.js.
import { firefox } from 'playwright';
import { datetime, filenamify, prompt, handleSIGINT, jsonDb, clearBrowserLock, notify } from './src/util.js';
import { cfg } from './src/config.js';
import { FingerprintInjector } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';

// Module-level state populated during the run; persisted to
// data/aliexpress.json so the Stats tab can compute deltas run-over-run.
const db = await jsonDb('aliexpress.json', { runs: [] });
let userCoinsNum = null;
let streakDays = null;
let tomorrowCoins = null;
let collected = false;
let totalEuro = null;

const { fingerprint, headers } = new FingerprintGenerator().getFingerprint({
  devices: ['mobile'],
  operatingSystems: ['android'],
});

clearBrowserLock(cfg.dir.browser + '-aliexpress');

// Firefox + desktop URL avoids the AWSC slider that Chromium mobile triggers.
const context = await firefox.launchPersistentContext(cfg.dir.browser + '-aliexpress', {
  headless: cfg.headless,
  locale: 'en-US',
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
  recordHar: cfg.record ? { path: `data/record/aliexpress-${filenamify(datetime())}.har` } : undefined,
  handleSIGINT: false,
  userAgent: fingerprint.navigator.userAgent,
  viewport: {
    width: fingerprint.screen.width,
    height: fingerprint.screen.height,
  },
  extraHTTPHeaders: {
    'accept-language': headers['accept-language'],
  },
  firefoxUserPrefs: { 'dom.webdriver.enabled': false },
});
handleSIGINT(context);
await new FingerprintInjector().attachFingerprintToPlaywright(context, { fingerprint, headers });

context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage();

const auth = async url => {
  console.log('auth', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await Promise.any([
    page.waitForURL(/.*login\.aliexpress\.com.*/).then(async () => {
      console.error('Not logged in! Will wait for 120s for you to login in the browser or terminal...');
      context.setDefaultTimeout(120 * 1000);
      page.locator('span:has-text("Switch account")').click().catch(_ => {});
      const login = page.locator('.login-container');
      const email = cfg.ae_email || await prompt({ message: 'Enter email' });
      const emailInput = login.locator('input[label="Email or phone number"]');
      await emailInput.fill(email);
      await emailInput.blur();
      const continueButton = login.locator('button:has-text("Continue")');
      await continueButton.click({ force: true });
      await continueButton.click();
      const password = email && (cfg.ae_password || await prompt({ type: 'password', message: 'Enter password' }));
      await login.locator('input[label="Password"]').fill(password);
      await login.locator('button:has-text("Sign in")').click();
      const error = login.locator('.error-text');
      error.waitFor().then(async _ => console.error('Login error (please restart):', await error.innerText())).catch(_ => {});
      await page.waitForURL(url);
      page.getByRole('button', { name: 'Accept cookies' }).click().then(_ => console.log('Accepted cookies')).catch(_ => {});
      context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);
      console.log('Logged in!');
    }),
    page.locator('#nav-user-account, .nav-user-account').waitFor(),
  ]).catch(_ => {});
};

const urls = {
  // Desktop URL (Firefox) — avoids the AWSC slider that appears on mobile/Chromium
  coins: 'https://www.aliexpress.com/p/coin-pc-index/index.html',
};

const pre_auth = {
  coins: async _ => {
    console.log('Checking coins...');
    let d;
    await page.waitForResponse(r => r.request().method() === 'POST' && r.url().startsWith('https://acs.aliexpress.com/h5/mtop.aliexpress.coin.execute/'))
      .then(async r => {
        d = await r.json();
        d = d.data.data;
        if (Array.isArray(d)) userCoinsNum = Number(d.find(e => e.name === 'userCoinsNum')?.value) || null;
        console.log('Total (coins):', userCoinsNum);
      })
      .catch(e => console.error('Total (coins): error:', e, 'data:', d));
  },
};

const coins = async () => {
  console.log('Collecting coins...');
  // Desktop selectors first, mobile selectors as fallback
  const collectBtn = page.locator('.checkin-button, button:has-text("Collect")').first();
  const alreadyBtn = page.locator('.addcoin, button:has-text("Earn more coins")').first();
  await Promise.race([
    collectBtn.click({ force: true }).then(_ => { collected = true; console.log('Collected coins for today!'); }),
    alreadyBtn.waitFor().then(_ => console.log('No more coins to collect today!')),
  ]);
  try {
    const coinText = await page.locator('.mycoin-content-right-money').innerText().catch(() => null);
    if (coinText) userCoinsNum = Number(coinText.replace(/[^\d]/g, '')) || userCoinsNum;
    console.log('Total (coins):', userCoinsNum);
  } catch {}
  try {
    streakDays = Number(await page.locator('.title-box, h3:text-is("day streak")').first().innerText());
    console.log('Streak (days):', streakDays);
  } catch {}
  try {
    const tomorrowText = await page.locator('.addcoin, :text("coins tomorrow")').first().innerText();
    tomorrowCoins = Number(tomorrowText.replace(/\D+(\d+).*/s, '$1')) || null;
    console.log('Tomorrow (coins):', tomorrowCoins);
  } catch {}
  try {
    totalEuro = await page.locator(':text("€")').first().innerText();
    console.log('Total (€):', totalEuro);
  } catch {}
};

async function recordRun() {
  if (userCoinsNum == null && streakDays == null) return; // nothing to record
  const entry = { at: datetime(), balance: userCoinsNum, streak: streakDays, tomorrow: tomorrowCoins, collected, totalEuro };
  // Compute earned-vs-previous-run for Stats tab convenience.
  const prev = (db.data.runs || []).filter(r => typeof r.balance === 'number').slice(-1)[0];
  if (prev && typeof entry.balance === 'number') entry.earned = Math.max(0, entry.balance - prev.balance);
  db.data.runs.push(entry);
  if (db.data.runs.length > 500) db.data.runs = db.data.runs.slice(-500);
  try { await db.write(); }
  catch (e) { console.error('aliexpress: db.write failed:', e.message); }
}

try {
  await [coins].reduce((a, f) => a.then(async _ => {
    const prep = (pre_auth[f.name] ?? (_ => undefined))();
    await auth(urls[f.name]);
    await prep;
    await f();
    console.log();
  }), Promise.resolve());
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error);
  if (error.message && process.exitCode != 130) await notify(`aliexpress failed: ${error.message.split('\n')[0]}`).catch(() => {});
}

await recordRun();

{
  const parts = [];
  if (collected) parts.push('coiny zebrane ✓');
  else parts.push('coiny już zebrane wcześniej');
  if (userCoinsNum != null) parts.push(`saldo: ${userCoinsNum} coinów`);
  if (streakDays != null) parts.push(`streak: ${streakDays} dni`);
  if (tomorrowCoins != null) parts.push(`jutro: +${tomorrowCoins}`);
  if (totalEuro != null) parts.push(`wartość: ${totalEuro}`);
  await notify(`aliexpress: ${parts.join(' | ')}`).catch(e => console.error('notify failed:', e.message));
}

if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
