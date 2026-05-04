import { resolve, jsonDb, datetime, filenamify, prompt, confirm, notify, html_game_list, handleSIGINT, closeContextSafely, writeLastRun, log, normalizeTitle, awaitUserCaptchaSolve, launchBrowser } from './src/util.js';
import { cfg } from './src/config.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'gog', ...a);

const URL_CLAIM = 'https://www.gog.com/en';

log.section('GOG');
log.status('Time', datetime());

const db = await jsonDb('gog.json', {});

if (cfg.width < 1280) { // otherwise 'Sign in' and #menuUsername are hidden (but attached to DOM), see https://github.com/vogler/free-games-claimer/issues/335
  log.warn(`Window width ${cfg.width} is below 1280 minimum for GOG`);
  process.exit(1);
}

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await launchBrowser({ harPrefix: 'gog' });

handleSIGINT(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage();
await page.setViewportSize({ width: cfg.width, height: cfg.height });

const notify_games = [];
let user;

try {
  await context.addCookies([{ name: 'CookieConsent', value: '{stamp:%274oR8MJL+bxVlG6g+kl2we5+suMJ+Tv7I4C5d4k+YY4vrnhCD+P23RQ==%27%2Cnecessary:true%2Cpreferences:true%2Cstatistics:true%2Cmarketing:true%2Cmethod:%27explicit%27%2Cver:1%2Cutc:1672331618201%2Cregion:%27de%27}', domain: 'www.gog.com', path: '/' }]);

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });

  const signIn = page.locator('a:has-text("Sign in"), [hook-test="menuAnonymousButton"]').first();
  const loggedInSel = '#menuUsername, [hook-test="menuUsername"], .menu-username, .menu-username-text, a[href*="/account"]';
  const username = page.locator(loggedInSel).first();
  await page.waitForTimeout(3000);
  const isLoggedIn = async () => await username.count() > 0;
  while (!await isLoggedIn()) {
    log.warn('Not signed in');
    if (cfg.nowait) process.exit(1);
    if (await signIn.count() === 0) {
      throw new Error('Could not find sign-in button. GOG page layout may have changed.');
    }
    await signIn.click({ force: true });
    await page.waitForSelector('#GalaxyAccountsFrameContainer iframe');
    const iframe = page.frameLocator('#GalaxyAccountsFrameContainer iframe');
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout);
    log.status('Login timeout', `${cfg.login_timeout / 1000}s`);
    if (cfg.gog_email && cfg.gog_password) log.info('Using credentials from environment');
    else log.info('Press ESC to login in browser (not possible in headless mode)');
    const email = cfg.gog_email || await prompt({ message: 'Enter email' });
    const password = email && (cfg.gog_password || await prompt({ type: 'password', message: 'Enter password' }));
    if (email && password) {
      if (!await iframe.locator('#login_username').isDisabled()) {
        await iframe.locator('#login_username').fill(email);
      }
      await iframe.locator('#login_password').fill(password);
      await iframe.locator('#login_login').click();
      await page.waitForTimeout(2000); // patchright waits forever for MFA locator otherwise
      iframe.locator('form[name=second_step_authentication]').waitFor().then(async () => {
        log.info('Two-Step Verification — enter security code');
        log.info(await iframe.locator('.form__description').innerText());
        const otp = await prompt({ type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 4 || 'The code must be 4 digits!' });
        await iframe.locator('#second_step_authentication_token_letter_1').pressSequentially(otp.toString(), { delay: 10 });
        await iframe.locator('#second_step_authentication_send').click();
        await page.waitForTimeout(1000);
      }).catch(_ => { });
      iframe.locator('text=Invalid captcha').waitFor().then(async () => {
        log.warn('Got captcha during login — solve in browser, get a new IP or try again later');
        await awaitUserCaptchaSolve(page, {
          service: 'gog',
          label: 'Login captcha',
          captchaCheck: () => iframe.locator('text=Invalid captcha').isVisible().catch(() => false),
        });
      }).catch(_ => { });
      await page.waitForSelector(loggedInSel);
    } else {
      log.info('Waiting for you to login in the browser');
      await notify('gog: no longer signed in and not enough options set for automatic login.');
      if (cfg.headless) {
        log.info('Run `SHOW=1 node gog` to login in the opened browser');
        await context.close();
        process.exit(1);
      }
    }
    await page.waitForSelector(loggedInSel);
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  const userSelectors = '#menuUsername, [hook-test="menuUsername"], .menu-username, .menu-username-text';
  const userEl = page.locator(userSelectors).first();
  try {
    await userEl.waitFor({ timeout: 10000 });
    user = await userEl.evaluate(el => {
      const direct = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (direct) return direct;
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    });
  } catch {
    try {
      user = await page.locator(userSelectors).first().getAttribute('title', { timeout: 5000 });
    } catch {}
  }
  if (!user) {
    try {
      user = await page.evaluate(() => {
        const cookies = document.cookie.split(';');
        for (const c of cookies) {
          const [k, v] = c.trim().split('=');
          if (k === 'gog_username' || k === 'gog-username') return decodeURIComponent(v);
        }
        const profile = document.querySelector('a[href^="/u/"]');
        if (profile) {
          const text = (profile.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) return text;
        }
        return null;
      });
    } catch {}
  }
  if (user && /^(Games|Orders|Wishlist|Friends|Library|Account|Settings)(\s+\d+)?$/i.test(user)) {
    log.warn(`Detected username looked like a nav label ("${user}") — discarding`);
    user = null;
  }
  if (!user) {
    user = cfg.gog_email?.split('@')[0] || 'unknown';
    log.warn(`Could not detect GOG username — using "${user}"`);
  }
  user = user.replace(/\s+/g, ' ').trim();
  log.status('User', user);
  db.data[user] ||= {};

  const banner = page.locator('#giveaway');
  await page.waitForTimeout(2000);
  if (!await banner.count()) {
    log.info('No free giveaway right now');
  } else {
    const text = await page.locator('.giveaway__content-header').innerText();
    const match_all = text.match(/Claim (.*) and don't miss the|Success! (.*) was added to/);
    const title = match_all[1] ? match_all[1] : match_all[2];
    const url = await banner.locator('a').first().getAttribute('href');
    log.game(title, url);
    db.data[user][title] ||= { title, time: datetime(), url };
    if (cfg.dryrun) process.exit(1);
    if (cfg.interactive && !await confirm()) process.exit(0);
    await banner.screenshot({ path: screenshot(`${filenamify(title)}.png`) });

    await page.goto('https://www.gog.com/giveaway/claim');
    const response = await page.innerText('body');
    let status;
    if (response == '{}') {
      status = 'claimed';
      log.ok(`${title} — claimed!`);
    } else {
      const message = JSON.parse(response).message;
      if (message == 'Already claimed') {
        status = 'existed';
        log.ok(`${title} — already in library`);
      } else {
        log.warn(`${title} — ${message}`);
        status = message;
      }
    }
    db.data[user][title].status ||= status;
    const notify_entry = { title, url, status };
    if (status !== 'claimed' && status !== 'existed') {
      notify_entry.details = `Game: ${url}`;
    }
    notify_games.push(notify_entry);

    if (status == 'claimed' && !cfg.gog_newsletter) {
      log.info('Unsubscribing from newsletters');
      await page.goto('https://www.gog.com/en/account/settings/subscriptions');
      await page.locator('li:has-text("Marketing communications through Trusted Partners") label').uncheck();
      await page.locator('li:has-text("Promotions and hot deals") label').uncheck();
    }
  }

  // Catalog watch — discover GOG games that are free outside the homepage spotlight giveaway flow.
  try {
    const watchDb = await jsonDb('gog-catalog-watch.json', { _baseline: false });
    const fetchCatalog = async qs => page.evaluate(async u => {
      const r = await fetch(u, { credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return j?.products || [];
    }, `https://catalog.gog.com/v1/catalog?${qs}`);
    const [tagged, discounted] = await Promise.all([
      fetchCatalog('tags=freegame&price=between:0,0&limit=100'),
      fetchCatalog('price=between:0,0&discounted=true&order=desc:discount&limit=50'),
    ]);
    const bySlug = new Map();
    for (const p of [...tagged, ...discounted]) {
      if (p?.slug && typeof p.slug === 'string' && p?.title) {
        bySlug.set(p.slug, p);
      }
    }
    const free = Array.from(bySlug.values());
    const now = Date.now();
    const RENOTIFY_AFTER_MS = 30 * 86400 * 1000;

    if (!watchDb.data._baseline) {
      for (const p of free) {
        watchDb.data[p.slug] = {
          title: p.title,
          url: `https://www.gog.com/en/game/${p.slug}`,
          firstSeen: datetime(),
          lastSeenAt: now,
        };
      }
      watchDb.data._baseline = true;
      await watchDb.write();
      log.info(`Catalog watch — baseline established (${free.length} free game(s) recorded silently). Subsequent runs notify on new additions only.`);
    } else {
      const newPromos = [];
      for (const p of free) {
        const existing = watchDb.data[p.slug];
        if (existing?.lastSeenAt && (now - existing.lastSeenAt) < RENOTIFY_AFTER_MS) {
          existing.lastSeenAt = now;
          continue;
        }
        const promoUrl = `https://www.gog.com/en/game/${p.slug}`;
        watchDb.data[p.slug] = {
          title: p.title,
          url: promoUrl,
          firstSeen: datetime(),
          lastSeenAt: now,
        };
        newPromos.push({ title: p.title, url: promoUrl });
      }
      await watchDb.write();
      if (newPromos.length) {
        log.info(`Catalog watch — ${newPromos.length} new free game(s): ${newPromos.map(g => g.title).join(', ')}`);
        const lines = newPromos.map(g => `${g.title} — ${g.url}`).join('<br>');
        await notify(`GOG: ${newPromos.length} free game${newPromos.length > 1 ? 's' : ''} available<br>${lines}`);
      } else {
        log.info(`Catalog watch — ${free.length} free item(s) tracked, no new additions`);
      }
    }
  } catch (e) {
    log.warn(`Catalog watch skipped — ${e.message}`);
    if (cfg.debug) console.error(e);
  }

  // Reconcile Prime Gaming's pending GOG codes against the authenticated user's library.
  try {
    const pgDb = await jsonDb('prime-gaming.json', {});
    const candidates = [];
    for (const games of Object.values(pgDb.data)) {
      if (!games || typeof games !== 'object') continue;
      for (const [title, entry] of Object.entries(games)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.store !== 'gog.com') continue;
        if (!entry.code) continue;
        if (/redeemed|expired|invalid/i.test(String(entry.status || ''))) continue;
        candidates.push({ title, entry });
      }
    }
    if (candidates.length) {
      log.status('Reconciling Prime Gaming codes', `${candidates.length} pending GOG entries`);
      const libraryTitles = new Set();
      let pageNum = 1;
      let totalPages = 1;
      do {
        const body = await page.evaluate(async p => {
          const r = await fetch(`https://www.gog.com/account/getFilteredProducts?mediaType=1&page=${p}&sortBy=title`, { credentials: 'include' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        }, pageNum);
        const j = JSON.parse(body);
        totalPages = j.totalPages || 1;
        for (const product of j.products || []) {
          if (product?.title) libraryTitles.add(normalizeTitle(product.title));
        }
        pageNum++;
      } while (pageNum <= totalPages && pageNum <= 30);
      log.status('GOG library', `${libraryTitles.size} title(s) loaded`);

      let reconciled = 0;
      for (const { title, entry } of candidates) {
        if (libraryTitles.has(normalizeTitle(title))) {
          entry.status = 'claimed and redeemed (verified via GOG library)';
          reconciled++;
          log.ok(`${title} — found in GOG library, marked redeemed`);
        }
      }
      if (reconciled) {
        await pgDb.write();
        log.info(`Reconciled ${reconciled}/${candidates.length} pending Prime Gaming code(s) against GOG library`);
      } else {
        log.info(`No pending Prime Gaming codes matched against library — checking remaining codes against GOG redeem endpoint`);
      }

      const stillPending = candidates.filter(({ entry }) => !/redeemed|expired|invalid/i.test(String(entry.status || '')));
      if (stillPending.length) {
        log.status('Probing remaining codes via redeem endpoint', `${stillPending.length}`);
        let probed = 0, notFound = 0, used = 0, captcha = 0;
        const probePage = await context.newPage();
        try {
          for (const { title, entry } of stillPending) {
            try {
              await probePage.goto('https://www.gog.com/redeem', { waitUntil: 'domcontentloaded', timeout: 20000 });
              await probePage.fill('#codeInput', entry.code);
              const respPromise = probePage.waitForResponse(
                r => r.request().method() === 'GET' && r.url().startsWith('https://redeem.gog.com/v1/bonusCodes/'),
                { timeout: 15000 },
              );
              await probePage.click('[type="submit"]');
              const resp = await respPromise;
              const body = await resp.text();
              probed++;
              let j;
              try { j = JSON.parse(body); } catch { j = {}; }
              const reason = String(j.reason || '').toLowerCase();
              if (reason === 'code_not_found') {
                entry.status = 'claimed, code expired or invalid';
                notFound++;
                log.warn(`${title} — code not found on GOG, marked invalid`);
              } else if (reason === 'code_used') {
                if (libraryTitles.has(normalizeTitle(title))) {
                  entry.status = 'claimed and redeemed (verified via GOG)';
                  used++;
                  log.ok(`${title} — already redeemed on GOG (in library), marked redeemed`);
                } else {
                  entry.status = 'claimed, code consumed but not in library (likely expired)';
                  notFound++;
                  log.warn(`${title} — GOG says code_used but title not in library, marked expired`);
                }
              } else if (reason.includes('captcha')) {
                captcha++;
                log.warn(`${title} — captcha required, stopping probe (${stillPending.length - probed} remaining)`);
                break;
              } else if (j?.products?.length) {
                log.info(`${title} — valid and redeemable (${j.products[0]?.title}); leaving pending for manual redeem`);
              } else {
                if (cfg.debug) console.debug(`  Probe response for ${title}:`, body);
                log.info(`${title} — unknown response, leaving pending`);
              }
            } catch (err) {
              log.warn(`${title} — probe error: ${err.message}`);
            }
          }
        } finally {
          await probePage.close();
        }
        if (notFound || used) {
          await pgDb.write();
          log.info(`Probed ${probed}: ${used} redeemed, ${notFound} invalid${captcha ? `, ${captcha} captcha-gated` : ''}`);
        }
      }
    }
  } catch (e) {
    log.warn(`Library reconcile skipped — ${e.message}`);
    if (cfg.debug) console.error(e);
  }

} catch (error) {
  process.exitCode ||= 1;
  log.fail(`Exception: ${error.message || error}`);
  if (cfg.debug) console.error(error);
  if (error.message && process.exitCode != 130) await notify(`gog failed: ${error.message.split('\n')[0]}`, { attachLatestScreenshot: true });
} finally {
  await db.write();
  writeLastRun('gog');
  log.sectionEnd();
  if (notify_games.filter(g => g.status != 'existed').length) {
    await notify(`gog (${user}):<br>${html_game_list(notify_games)}`);
  }
}
if (page.video()) log.info(`Recorded video — ${await page.video().path()}`);
await closeContextSafely(context);
