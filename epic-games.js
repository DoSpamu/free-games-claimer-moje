import { chromium } from 'patchright';
import { authenticator } from 'otplib';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import { resolve, jsonDb, datetime, filenamify, prompt, confirm, notify, html_game_list, handleSIGINT, closeContextSafely, writeLastRun, log, launchBrowser } from './src/util.js';
import { cfg } from './src/config.js';
import { getMobileGames } from './src/epic-games-mobile.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'epic-games', ...a);

const URL_CLAIM = 'https://store.epicgames.com/en-US/free-games';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;
const URL_PROMOTIONS = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US';

log.section('Epic Games');
log.status('Time', datetime());

const offerIdMap = {};
try {
  const res = await fetch(URL_PROMOTIONS);
  const data = await res.json();
  for (const el of data?.data?.Catalog?.searchStore?.elements || []) {
    const promos = el.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
    const isFree = promos.some(o => o.discountSetting?.discountPercentage === 0);
    if (!isFree) continue;
    const slug = el.catalogNs?.mappings?.[0]?.pageSlug || el.urlSlug;
    if (slug) offerIdMap[decodeURIComponent(slug).toLowerCase()] = el.id;
  }
  if (Object.keys(offerIdMap).length) {
    log.status('Offer IDs fetched', Object.keys(offerIdMap).length);
  }
} catch (e) {
  log.warn('Could not fetch offer IDs from promotions API');
  if (cfg.debug) console.error(e);
}

const db = await jsonDb('epic-games.json', {});

if (cfg.time) console.time('startup');

// headless:false required — SHOW=0 leads to captcha detection
const context = await launchBrowser({ headless: false, harPrefix: 'eg', extraArgs: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });

if (cfg.debug) console.log(chromium.executablePath());

handleSIGINT(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage();

if (cfg.debug) console.debug(await page.evaluate(() => [(({ width, height, availWidth, availHeight }) => ({ width, height, availWidth, availHeight }))(window.screen), navigator.userAgent, navigator.platform, navigator.vendor]));
if (cfg.debug_network) {
  const filter = r => r.url().includes('store.epicgames.com');
  page.on('request', request => filter(request) && console.log('>>', request.method(), request.url()));
  page.on('response', response => filter(response) && console.log('<<', response.status(), response.url()));
}

const notify_games = [];
let user;

try {
  await context.addCookies([
    { name: 'OptanonAlertBoxClosed', value: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), domain: '.epicgames.com', path: '/' },
    { name: 'HasAcceptedAgeGates', value: 'USK:9007199254740991,general:18,EPIC SUGGESTED RATING:18', domain: 'store.epicgames.com', path: '/' },
  ]);

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });

  if (cfg.time) console.timeEnd('startup');
  if (cfg.time) console.time('login');

  page.locator('button:has-text("Continue")').click().catch(_ => { });

  while (await page.locator('egs-navigation').getAttribute('isloggedin') != 'true') {
    log.warn('Not signed in');
    if (cfg.nowait) process.exit(1);
    if (cfg.novnc_port) log.info(`Open http://localhost:${cfg.novnc_port} to login inside the docker container`);
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout);
    log.status('Login timeout', `${cfg.login_timeout / 1000}s`);
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    if (cfg.eg_email && cfg.eg_password) log.info('Using credentials from environment');
    else log.info('Press ESC to login in browser (not possible in headless mode)');
    const notifyBrowserLogin = async () => {
      log.info('Waiting for you to login in the browser');
      await notify('epic-games: no longer signed in and not enough options set for automatic login.');
      if (cfg.headless) {
        log.info('Run `SHOW=1 node epic-games` to login in the opened browser');
        await context.close();
        process.exit(1);
      }
    };
    const email = cfg.eg_email || await prompt({ message: 'Enter email' });
    if (!email) await notifyBrowserLogin();
    else {
      page.waitForSelector('.h_captcha_challenge iframe').then(async () => {
        log.warn('Got captcha during login — solve in browser, get a new IP or try again later');
        await notify('epic-games: got captcha during login. Please check.');
      }).catch(_ => { });
      page.waitForSelector('p:has-text("Incorrect response.")').then(async () => {
        log.warn('Incorrect captcha response');
      }).catch(_ => { });
      await page.fill('#email', email);
      await page.click('button#continue');
      const password = email && (cfg.eg_password || await prompt({ type: 'password', message: 'Enter password' }));
      if (!password) await notifyBrowserLogin();
      else {
        await page.fill('#password', password);
        await page.click('button#sign-in');
      }
      const error = page.locator('#form-error-message');
      error.waitFor().then(async () => {
        log.fail(`Login error — ${await error.innerText()}`);
        log.info('Please login in the browser');
      }).catch(_ => { });
      page.waitForURL('**/id/login/mfa**').then(async () => {
        log.info('Enter the security code — new device/browser/location detected');
        const otp = cfg.eg_otpkey && authenticator.generate(cfg.eg_otpkey) || await prompt({ type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 6 || 'The code must be 6 digits!' });
        await page.locator('input[name="code-input-0"]').pressSequentially(otp.toString());
        await page.click('button[type="submit"]');
      }).catch(_ => { });
    }
    await page.waitForURL(URL_CLAIM);
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  user = await page.locator('egs-navigation').getAttribute('displayname');
  log.status('User', user);
  db.data[user] ||= {};
  if (cfg.time) console.timeEnd('login');
  if (cfg.time) console.time('claim all games');

  const game_loc = page.locator('a:has(span:text-is("Free Now"))');
  await game_loc.last().waitFor().catch(_ => {
    log.warn('No free games available in your region');
  });
  const urlSlugs = await Promise.all((await game_loc.all()).map(a => a.getAttribute('href')));
  const urls = urlSlugs.map(s => 'https://store.epicgames.com' + s);

  // Free mobile games - https://github.com/vogler/free-games-claimer/issues/474
  if (cfg.eg_mobile) {
    log.status('Mobile games', 'included');
    try {
      const mobileGames = await getMobileGames(context);
      urls.push(...mobileGames.map(x => x.url));
    } catch (e) {
      log.warn(`Could not fetch mobile games: ${e.message?.split('\n')[0]}`);
    }
  }

  const titleCounts = {};
  for (const url of urls) {
    const id = url.split('/').pop();
    const t = db.data[user][id]?.title || id;
    titleCounts[t] = (titleCounts[t] || 0) + 1;
  }
  const uniqueCount = Object.keys(titleCounts).length;
  if (uniqueCount < urls.length) {
    log.status('Free games found', `${uniqueCount} (${urls.length} incl. platform variants)`);
  } else {
    log.status('Free games found', urls.length);
  }
  if (cfg.debug) console.log('  URLs:', urls);
  const loggedTitles = new Set();

  for (const url of urls) {
    if (cfg.time) console.time('claim game');
    const skipId = url.split('/').pop();
    if (db.data[user][skipId]?.status == 'claimed') {
      const knownTitle = db.data[user][skipId]?.title || skipId;
      if (!loggedTitles.has(knownTitle)) {
        const platforms = titleCounts[knownTitle] || 1;
        const platformNote = platforms > 1 ? ` (${platforms} platforms)` : '';
        log.ok(`${knownTitle} — already claimed${platformNote}`);
        loggedTitles.add(knownTitle);
      }
      if (cfg.time) console.timeEnd('claim game');
      continue;
    }
    await page.goto(url);
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button[data-testid="purchase-cta-button"]');
        return btn && /[ei]/i.test(btn.textContent) && btn.textContent != 'Loading';
      }
    );
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
    const purchaseBtn = page.locator('button[data-testid="purchase-cta-button"]').first();
    const btnText = (await purchaseBtn.innerText()).toLowerCase();

    if (await page.locator('button:has-text("Continue")').count() > 0) {
      if (cfg.debug) console.log('  This game contains mature content recommended only for ages 18+');
      if (await page.locator('[data-testid="AgeSelect"]').count()) {
        log.warn('Got unexpected age gate — please report to https://github.com/vogler/free-games-claimer/issues/275');
        await page.locator('#month_toggle').click();
        await page.locator('#month_menu li:has-text("01")').click();
        await page.locator('#day_toggle').click();
        await page.locator('#day_menu li:has-text("01")').click();
        await page.locator('#year_toggle').click();
        await page.locator('#year_menu li:has-text("1987")').click();
      }
      await page.click('button:has-text("Continue")', { delay: 111 });
      await page.waitForTimeout(2000);
    }

    let title;
    let bundle_includes;
    if (await page.locator('span:text-is("About Bundle")').count()) {
      title = (await page.locator('span:has-text("Buy"):left-of([data-testid="purchase-cta-button"])').first().innerText()).replace('Buy ', '');
      try {
        bundle_includes = await Promise.all((await page.locator('.product-card-top-row h5').all()).map(b => b.innerText()));
      } catch (e) {
        if (cfg.debug) console.error('Failed to get "Bundle Includes":', e);
      }
    } else {
      title = await page.locator('h1').first().innerText();
    }
    const game_id = page.url().split('/').pop();
    const existedInDb = db.data[user][game_id];
    db.data[user][game_id] ||= { title, time: datetime(), url: page.url() };
    if (bundle_includes) log.info(`${title} includes: ${bundle_includes.join(', ')}`);
    const notify_game = { title, url, status: 'failed' };
    notify_games.push(notify_game);

    if (btnText == 'in library') {
      log.ok(`${title} — already in library`);
      notify_game.status = 'existed';
      db.data[user][game_id].status ||= 'existed';
      if (db.data[user][game_id].status.startsWith('failed')) db.data[user][game_id].status = 'manual';
    } else if (btnText == 'requires base game') {
      log.skip(title, 'requires base game');
      notify_game.status = 'requires base game';
      notify_game.details = `<a href="${url}">View game</a>`;
      db.data[user][game_id].status ||= 'failed:requires-base-game';
      const baseUrl = 'https://store.epicgames.com' + await page.locator('a:has-text("Overview")').getAttribute('href');
      log.info(`Base game — ${baseUrl}`);
      urls.push(baseUrl);
      urls.push(url);
    } else { // GET
      const recheckText = (await purchaseBtn.innerText().catch(() => btnText)).toLowerCase();
      if (recheckText === 'in library') {
        log.ok(`${title} — already in library (lagged ownership state)`);
        notify_game.status = 'existed';
        db.data[user][game_id].status ||= 'existed';
        if (db.data[user][game_id].status.startsWith('failed')) db.data[user][game_id].status = 'manual';
        if (cfg.time) console.timeEnd('claim game');
        continue;
      }
      log.game(title, `claiming (${btnText})`);
      let captchaDetected = false;
      await purchaseBtn.click({ delay: 11 });

      page.click('button:has-text("Continue")').catch(_ => { });
      page.click('button:has-text("Yes, buy now")').catch(_ => { });

      page.locator(':has-text("end user license agreement")').waitFor().then(async () => {
        log.info('Accepting End User License Agreement');
        if (cfg.debug) console.log(page.innerHTML);
        if (cfg.debug) console.log('Please report the HTML above here: https://github.com/vogler/free-games-claimer/issues/371');
        await page.locator('input#agree').check();
        await page.locator('button:has-text("Accept")').click();
      }).catch(_ => { });

      let iframe;
      try {
        await page.waitForSelector('#webPurchaseContainer iframe');
        iframe = page.frameLocator('#webPurchaseContainer iframe');
        if (await iframe.locator(':has-text("unavailable in your region")').count() > 0) {
          log.skip(title, 'unavailable in your region');
          db.data[user][game_id].status = notify_game.status = 'unavailable-in-region';
          notify_game.details = `<a href="${url}">View game</a>`;
          if (cfg.time) console.timeEnd('claim game');
          continue;
        }

        iframe.locator('.payment-pin-code').waitFor().then(async () => {
          if (!cfg.eg_parentalpin) {
            log.warn('EG_PARENTALPIN not set — enter Parental Control PIN manually');
            notify('epic-games: EG_PARENTALPIN not set. Need to enter Parental Control PIN manually.');
          }
          await iframe.locator('input.payment-pin-code__input').first().pressSequentially(cfg.eg_parentalpin);
          await iframe.locator('button:has-text("Continue")').click({ delay: 11 });
        }).catch(_ => { });

        if (cfg.debug) await page.pause();
        if (cfg.dryrun) {
          log.warn('dry run — skipping claim');
          notify_game.status = 'skipped';
          if (cfg.time) console.timeEnd('claim game');
          continue;
        }
        if (cfg.interactive && !await confirm()) {
          if (cfg.time) console.timeEnd('claim game');
          continue;
        }

        await iframe.locator('button:has-text("Place Order"):not(:has(.payment-loading--loading))').click({ delay: 11 });

        const btnAgree = iframe.locator('button:has-text("I Accept")');
        btnAgree.waitFor().then(() => btnAgree.click()).catch(_ => { });
        const captcha = iframe.locator('#h_captcha_challenge_checkout_free_prod iframe');
        captcha.waitFor().then(async () => {
          captchaDetected = true;
          log.warn('Got hCaptcha challenge — solve in browser or get a new IP address');
          await notify(`epic-games: got captcha challenge for ${title}.\nGame link: ${url}`);
        }).catch(_ => { });
        iframe.locator('.payment__errors:has-text("Failed to challenge captcha, please try again later.")').waitFor().then(async () => {
          log.fail('Failed captcha challenge — try again later');
          await notify(`epic-games: failed captcha challenge for ${title}.\nGame link: ${url}`, { attachLatestScreenshot: true });
        }).catch(_ => { });
        await page.locator('text=Thanks for your order!').waitFor({ state: 'attached' });
        db.data[user][game_id].status = 'claimed';
        db.data[user][game_id].time = datetime();
        log.ok(`${title} — claimed!`);
      } catch (e) {
        log.fail(`${title} — failed to claim`);
        if (cfg.debug) console.error(e);
        const p = screenshot('failed', `${game_id}_${filenamify(datetime())}.png`);
        await page.screenshot({ path: p, fullPage: true });
        db.data[user][game_id].status = 'failed';
        try {
          const cta = (await page.locator('button[data-testid="purchase-cta-button"]').first().innerText().catch(() => '')).toLowerCase();
          if (cta === 'in library') {
            log.ok(`${title} — actually already in library (Get button was stale)`);
            db.data[user][game_id].status = notify_game.status = 'existed';
          }
        } catch { /* CTA probe is best-effort */ }
        if (iframe && (captchaDetected || await iframe.locator('#h_captcha_challenge_checkout_free_prod iframe').count().catch(() => 0) > 0)) {
          captchaDetected = true;
          notify_game.captcha = true;
        }
      }
      notify_game.status = db.data[user][game_id].status;
      if (notify_game.status === 'failed') {
        if (captchaDetected) {
          notify_game.details = `Captcha blocked claim — will retry. <a href="${url}">View game</a>`;
        } else {
          notify_game.details = `<a href="${url}">View game</a>`;
        }
      }

      const p = screenshot(`${game_id}.png`);
      if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false });
    }
    if (cfg.time) console.timeEnd('claim game');
  }

  const captchaRetries = notify_games.filter(g => g.captcha && g.status === 'failed');
  if (captchaRetries.length) {
    log.info(`Retrying ${captchaRetries.length} captcha-failed game(s) in 60s...`);
    await page.waitForTimeout(60000);
    for (const retry of captchaRetries) {
      log.info(`Retrying ${retry.title}...`);
      try {
        await page.goto(retry.url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => {
            const btn = document.querySelector('button[data-testid="purchase-cta-button"]');
            return btn && /[ei]/i.test(btn.textContent) && btn.textContent != 'Loading';
          }
        );
        const purchaseBtn = page.locator('button[data-testid="purchase-cta-button"]').first();
        const btnText = (await purchaseBtn.innerText()).toLowerCase();
        if (btnText === 'in library') {
          log.ok(`${retry.title} — claimed (already in library after retry)`);
          retry.status = 'claimed';
          retry.details = '';
          retry.captcha = false;
          const game_id = page.url().split('/').pop();
          db.data[user][game_id].status = 'claimed';
          continue;
        }
        if (btnText !== 'get') {
          log.fail(`${retry.title} — unexpected button: ${btnText}`);
          retry.status = 'failed';
          retry.details = `Retry also failed. Game: ${retry.url}`;
          continue;
        }
        log.game(retry.title, 'claiming (retry)');
        await purchaseBtn.click({ delay: 11 });
        page.click('button:has-text("Continue")').catch(_ => { });
        page.click('button:has-text("Yes, buy now")').catch(_ => { });
        await page.waitForSelector('#webPurchaseContainer iframe');
        const iframe = page.frameLocator('#webPurchaseContainer iframe');
        const btnAgree = iframe.locator('button:has-text("I Accept")');
        btnAgree.waitFor().then(() => btnAgree.click()).catch(_ => { });
        await iframe.locator('button:has-text("Place Order"):not(:has(.payment-loading--loading))').click({ delay: 11 });
        await page.locator('text=Thanks for your order!').waitFor({ state: 'attached' });
        const game_id = page.url().split('/').pop();
        db.data[user][game_id].status = 'claimed';
        db.data[user][game_id].time = datetime();
        log.ok(`${retry.title} — claimed on retry!`);
        retry.status = 'claimed';
        retry.details = '';
        retry.captcha = false;
      } catch (e) {
        log.fail(`${retry.title} — retry failed`);
        if (cfg.debug) console.error(e);
        retry.details = `Retry also failed. Game: ${retry.url}`;
      }
    }
  }

  const failedGames = notify_games.filter(g => g.status === 'failed');
  if (failedGames.length && Object.keys(offerIdMap).length) {
    const slugFromUrl = url => {
      try { return decodeURIComponent(new URL(url).pathname.replace(/\/+$/, '').split('/').pop()).toLowerCase(); } catch { return url.split('/').pop().toLowerCase(); }
    };
    const failedOfferIds = [...new Set(failedGames.map(g => offerIdMap[slugFromUrl(g.url)]).filter(Boolean))];
    if (cfg.debug) {
      const unmatched = failedGames.filter(g => !offerIdMap[slugFromUrl(g.url)]);
      if (unmatched.length) console.debug('  Cart fallback — unmatched slugs:', unmatched.map(g => slugFromUrl(g.url)));
    }
    if (failedOfferIds.length) {
      log.info(`Cart fallback — ${failedOfferIds.length}/${failedGames.length} failed game(s) matched to offer IDs`);
      const cartUrl = `https://store.epicgames.com/en-US/cart?${failedOfferIds.map(id => `offerId=${id}`).join('&')}`;
      log.info(`Cart link — ${cartUrl}`);
      for (const g of failedGames) {
        const offerId = offerIdMap[slugFromUrl(g.url)];
        if (offerId) {
          const singleCartUrl = `https://store.epicgames.com/en-US/cart?offerId=${offerId}`;
          g.details = (g.details ? g.details + ' · ' : '') + `<a href="${singleCartUrl}">Claim in cart</a>`;
        }
      }
      notify_games.push({ title: `🛒 Claim ${failedOfferIds.length} game(s) in one click`, url: cartUrl, status: 'action' });
    } else {
      log.warn(`Cart fallback — 0/${failedGames.length} failed game(s) matched to offer IDs`);
    }
  }
} catch (error) {
  process.exitCode ||= 1;
  log.fail(`Exception: ${error.message || error}`);
  if (cfg.debug) console.error(error);
  if (error.message && process.exitCode != 130) await notify(`epic-games failed: ${error.message.split('\n')[0]}`, { attachLatestScreenshot: true });
} finally {
  if (cfg.time) console.timeEnd('claim all games');
  await db.write();
  writeLastRun('epic-games');
  log.sectionEnd();
  if (notify_games.filter(g => g.status == 'claimed' || g.status == 'failed' || g.status == 'action').length) {
    await notify(`epic-games (${user}):<br>${html_game_list(notify_games)}`);
  }
}
if (cfg.debug) writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
if (page.video()) log.info(`Recorded video — ${await page.video().path()}`);
await closeContextSafely(context);
