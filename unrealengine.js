// Claim free Unreal Engine marketplace assets (new batch every first Tuesday of the month).
// Ported from DoSpamu/free-games-claimer enhanced branch — updated for patchright/chromium.

import { authenticator } from 'otplib';
import path from 'path';
import { writeFileSync } from 'fs';
import { resolve, jsonDb, datetime, filenamify, prompt, notify, html_game_list, handleSIGINT, clearBrowserLock, closeContextSafely, log, launchBrowser } from './src/util.js';
import { cfg } from './src/config.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'unrealengine', ...a);

const URL_CLAIM = 'https://www.unrealengine.com/marketplace/en-US/assets?count=20&sortBy=effectiveDate&sortDir=DESC&start=0&tag=4910';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;

log.section('unrealengine');

const db = await jsonDb('unrealengine.json', {});

clearBrowserLock(cfg.dir.browser);

const context = await launchBrowser({ headless: false, harPrefix: 'ue', extraArgs: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });

if (cfg.debug) console.log(chromium.executablePath());

handleSIGINT(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage();
await page.setViewportSize({ width: cfg.width, height: cfg.height });

const notify_games = [];
let user;

try {
  await context.addCookies([{ name: 'OptanonAlertBoxClosed', value: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), domain: '.epicgames.com', path: '/' }]);

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });

  await page.waitForResponse(r => r.request().method() == 'POST' && r.url().startsWith('https://graphql.unrealengine.com/ue/graphql'));

  while (await page.locator('unrealengine-navigation').getAttribute('isloggedin') != 'true') {
    console.error('Not signed in. Please login in the browser or here in the terminal.');
    if (cfg.novnc_port) console.info(`Open http://localhost:${cfg.novnc_port} to login inside the docker container.`);
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout);
    console.info(`Login timeout is ${cfg.login_timeout / 1000} seconds!`);
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    if (cfg.eg_email && cfg.eg_password) console.info('Using email and password from environment.');
    else console.info('Press ESC to skip the prompts if you want to login in the browser.');
    const email = cfg.eg_email || await prompt({ message: 'Enter email' });
    const password = email && (cfg.eg_password || await prompt({ type: 'password', message: 'Enter password' }));
    if (email && password) {
      await page.fill('#email', email);
      await page.click('button[type="submit"]');
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      page.waitForSelector('#h_captcha_challenge_login_prod iframe').then(() => {
        console.error('Got a captcha during login!');
        notify('unrealengine: got captcha during login. Please check.');
      }).catch(() => {});
      page.waitForURL('**/id/login/mfa**').then(async () => {
        console.log('MFA required — enter security code.');
        const otp = cfg.eg_otpkey && authenticator.generate(cfg.eg_otpkey) || await prompt({ type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 6 || 'Code must be 6 digits!' });
        await page.locator('input[name="code-input-0"]').pressSequentially(otp.toString());
        await page.click('button[type="submit"]');
      }).catch(() => {});
    } else {
      console.log('Waiting for you to login in the browser.');
      await notify('unrealengine: not signed in and not enough credentials set for automatic login.');
      if (cfg.headless) {
        console.log('Run `SHOW=1 node unrealengine` to login in the opened browser.');
        await closeContextSafely(context);
        process.exit(1);
      }
    }
    await page.waitForURL('**unrealengine.com/marketplace/**');
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  await page.waitForTimeout(1000);
  user = await page.locator('unrealengine-navigation').getAttribute('displayname');
  log.status(`Signed in as ${user}`);
  db.data[user] ||= {};

  page.locator('button:has-text("Accept All Cookies")').click().catch(() => {});

  const ids = [];
  for (const p of await page.locator('article.asset').all()) {
    const link = p.locator('h3 a');
    const title = await link.innerText();
    const url = 'https://www.unrealengine.com' + await link.getAttribute('href');
    const id = url.split('/').pop();
    db.data[user][id] ||= { title, time: datetime(), url, status: 'failed' };
    const notify_game = { title, url, status: 'failed' };
    notify_games.push(notify_game);
    log.game(title, url);
    if ((await p.getAttribute('class')).includes('asset--owned')) {
      log.status('  Already claimed');
      if (db.data[user][id].status != 'claimed') {
        db.data[user][id].status = 'existed';
        notify_game.status = 'existed';
      }
      continue;
    }
    if (await p.locator('.btn .in-cart').count()) {
      log.status('  Already in cart');
    } else {
      await p.locator('.btn .add').click();
      log.status('  Added to cart');
    }
    ids.push(id);
  }
  if (!ids.length) {
    log.status('Nothing to claim');
  } else {
    await page.waitForTimeout(2000);
    const price = (await page.locator('.shopping-cart .total .price').innerText()).split(' ');
    log.status(`Price: ${price[1]} instead of ${price[0]}`);
    if (price[1] != '0') {
      const err = 'Price is not 0! Please report at https://github.com/vogler/free-games-claimer/issues/44';
      console.error(err);
      await notify('unrealengine: ' + err);
      process.exit(1);
    }
    log.status('Click shopping cart');
    await page.locator('.shopping-cart').click();
    await page.locator('button.checkout').click();
    log.status('Click checkout');
    page.locator('[name=accept-label]').check().then(() => {
      log.status('Accept End User License Agreement');
      page.locator('span:text-is("Accept")').click();
    }).catch(() => {});
    await page.waitForSelector('#webPurchaseContainer iframe');
    const iframe = page.frameLocator('#webPurchaseContainer iframe');

    if (cfg.debug) await page.pause();
    if (cfg.dryrun) {
      log.status('DRYRUN=1 → Skip order!');
      throw new Error('DRYRUN=1');
    }

    log.status('Click Place Order');
    await iframe.locator('button:has-text("Place Order"):not(:has(.payment-loading--loading))').click({ delay: 11 });

    const btnAgree = iframe.locator('button:has-text("I Agree")');
    btnAgree.waitFor().then(() => btnAgree.click()).catch(() => {});
    try {
      const captcha = iframe.locator('#h_captcha_challenge_checkout_free_prod iframe');
      captcha.waitFor().then(async () => {
        console.error('  Got hcaptcha challenge! Solve in browser or get a new IP.');
      }).catch(() => {});
      await page.waitForSelector('text=Thank you');
      for (const id of ids) {
        db.data[user][id].status = 'claimed';
        db.data[user][id].time = datetime();
      }
      notify_games.forEach(g => g.status == 'failed' && (g.status = 'claimed'));
      log.status('Claimed successfully!');
    } catch (e) {
      console.error(e);
      console.error('  Failed to claim!');
      await page.screenshot({ path: screenshot('failed', `${filenamify(datetime())}.png`), fullPage: true });
      notify_games.forEach(g => g.status = 'failed');
    }

    if (notify_games.length) await page.screenshot({ path: screenshot(`${filenamify(datetime())}.png`), fullPage: false });
    log.status('Done');
  }
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error);
  if (error.message && process.exitCode != 130) await notify(`unrealengine failed: ${error.message.split('\n')[0]}`);
} finally {
  await db.write();
  if (notify_games.filter(g => g.status != 'existed').length) {
    await notify(`unrealengine (${user}):<br>${html_game_list(notify_games)}`);
  }
}
if (cfg.debug) writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
if (page.video()) console.log('Recorded video:', await page.video().path());
await closeContextSafely(context);
