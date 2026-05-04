import { chromium, devices } from 'patchright';
import { cfg } from '../config.js';

async function readMicrosoftRewardsUser(page) {
  try {
    // state: 'attached' rather than the default 'visible' — the ME Control
    // renders the name into hidden DOM until the widget is opened, so the
    // default visible-wait would time out even though the text is present.
    await page.waitForSelector('#mectrl_currentAccount_primary', { timeout: 8000, state: 'attached' });
    const name = await page.evaluate(() => {
      const primary = document.getElementById('mectrl_currentAccount_primary');
      const secondary = document.getElementById('mectrl_currentAccount_secondary');
      const p = primary && primary.textContent && primary.textContent.trim();
      const s = secondary && secondary.textContent && secondary.textContent.trim();
      return p || s || null;
    });
    if (name) return name;
  } catch (e) {
    console.log(`[ms] readUser: ${e.message}`);
  }
  return null;
}

export const SITES = {
  'prime-gaming': {
    name: 'Prime Gaming',
    loginUrl: 'https://luna.amazon.com/claims',
    browserDir: cfg.dir.browser,
    async checkLogin(page) {
      try {
        await page.goto('https://luna.amazon.com/claims', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        // Amazon redirects stale sessions to /ap/signin — check final URL first (real auth signal).
        if (/\/ap\/signin|\/sign[-_]?in/i.test(page.url())) return { loggedIn: false };
        const signInBtn = await page.locator('button:has-text("Sign in")').count();
        if (signInBtn > 0) return { loggedIn: false };
        const userEl = page.locator('[data-a-target="user-dropdown-first-name-text"]');
        if (await userEl.count() > 0) {
          const user = await userEl.first().innerText();
          return { loggedIn: true, user };
        }
        return { loggedIn: false };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'epic-games': {
    name: 'Epic Games',
    loginUrl: 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=https://store.epicgames.com/en-US/free-games',
    browserDir: cfg.dir.browser,
    async checkLogin(page) {
      try {
        await page.goto('https://store.epicgames.com/en-US/free-games', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        const nav = page.locator('egs-navigation');
        const isLoggedIn = await nav.getAttribute('isloggedin');
        if (isLoggedIn === 'true') {
          const user = await nav.getAttribute('displayname');
          return { loggedIn: true, user: user || 'unknown' };
        }
        return { loggedIn: false };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'gog': {
    name: 'GOG',
    loginUrl: 'https://www.gog.com/en',
    browserDir: cfg.dir.browser,
    async checkLogin(page) {
      try {
        // Navigate to /account — GOG server-side requires a valid session here;
        // stale sessions get redirected to the homepage with an #openlogin overlay.
        // The final URL is the definitive session-validity signal.
        await page.goto('https://www.gog.com/account', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        const url = page.url();
        if (url.includes('openlogin') || url.includes('/login')) return { loggedIn: false };
        if (!url.includes('/account')) return { loggedIn: false };

        // Primary username source: GOG's own account APIs. page.request
        // inherits the browser context's cookies, so a valid session
        // authenticates automatically. This sidesteps the DOM path entirely
        // — the legacy #menuUsername element carries data-hj-suppress (PII
        // suppression) and is frequently hidden or renamed across GOG's
        // header redesigns.
        let user = null;
        const apis = [
          'https://menu.gog.com/v1/account/basic',
          'https://www.gog.com/userData.json',
          'https://embed.gog.com/userData.json',
        ];
        for (const endpoint of apis) {
          try {
            const res = await page.request.get(endpoint, { timeout: 10000 });
            if (!res.ok()) continue;
            const data = await res.json();
            const name = data && (data.username || data.userName || data.name);
            if (name) { user = String(name).trim(); break; }
          } catch { /* try next endpoint */ }
        }

        // DOM fallback: open the account dropdown and parse the block of text
        // next to "Your account". Used only if all APIs fail.
        if (!user) {
          try {
            await page.goto('https://www.gog.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
            const trigger = page.locator([
              'header [class*="menu-user"]',
              'header [class*="account"]',
              'header button[aria-haspopup]:has(svg)',
            ].join(', ')).first();
            await trigger.waitFor({ state: 'visible', timeout: 8000 });
            await trigger.hover();
            const dropdown = page.locator('[class*="menu-user-dropdown"], [class*="account-menu"], [class*="menu-user"]')
              .filter({ hasText: 'Your account' }).first();
            try {
              await dropdown.waitFor({ state: 'visible', timeout: 3000 });
            } catch {
              await trigger.click();
              await dropdown.waitFor({ state: 'visible', timeout: 4000 });
            }
            const text = await dropdown.innerText({ timeout: 2000 }).catch(() => '');
            const m = text.match(/Your account\s*\n?\s*([^\n]+)/);
            if (m && m[1]) user = m[1].trim() || null;
            await page.keyboard.press('Escape').catch(() => {});
          } catch { /* DOM path failed — fall through */ }
        }

        // Tertiary: legacy cookie that some GOG builds still set.
        if (!user) {
          const cookieUser = await page.evaluate(() => {
            for (const c of document.cookie.split(';')) {
              const [k, v] = c.trim().split('=');
              if (k === 'gog_username' || k === 'gog-username') return decodeURIComponent(v);
            }
            return null;
          });
          if (cookieUser) user = cookieUser;
        }
        return { loggedIn: true, user: user || 'unknown' };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'steam': {
    name: 'Steam',
    loginUrl: 'https://store.steampowered.com/login/',
    browserDir: cfg.dir.browser,
    async checkLogin(page) {
      try {
        // /account/ is auth-gated — stale sessions get redirected to /login/.
        await page.goto('https://store.steampowered.com/account/', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        if (page.url().includes('/login/')) return { loggedIn: false };
        const pulldown = page.locator('#account_pulldown');
        if (await pulldown.count() > 0) {
          const user = (await pulldown.innerText()).trim();
          if (user.length > 0) return { loggedIn: true, user };
        }
        return { loggedIn: false };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'aliexpress': {
    name: 'AliExpress',
    // AliExpress's coin collector only works on the mobile site; desktop just
    // says "install the app". Use a dedicated browser profile so its
    // fingerprint-injected session doesn't collide with the desktop services'
    // profiles.
    loginUrl: 'https://m.aliexpress.com/p/coin-index/index.html',
    browserDir: cfg.dir.browser + '-aliexpress',
    contextOptions: devices['Pixel 7'],
    async checkLogin(page) {
      const loginBtn = page.locator('button:has-text("Log in")');
      const streak = page.locator('h3:text-is("day streak")');
      // AliExpress mobile frequently hangs on initial load — same issue as in
      // aliexpress.js auth(). Auto-reload up to 3 times until either the login
      // button or the logged-in "day streak" marker appears, then short-circuit.
      const QUICK_WAIT_MS = 15000;
      const MAX_RELOADS = 3;
      try {
        for (let attempt = 0; attempt <= MAX_RELOADS; attempt++) {
          if (attempt === 0) {
            await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          } else {
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          }
          const which = await Promise.any([
            loginBtn.waitFor({ state: 'visible', timeout: QUICK_WAIT_MS }).then(() => 'login'),
            streak.waitFor({ state: 'visible', timeout: QUICK_WAIT_MS }).then(() => 'streak'),
          ]).catch(() => null);
          if (which === 'streak') return { loggedIn: true, user: 'member' };
          if (which === 'login') return { loggedIn: false };
        }
        return { loggedIn: false };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'microsoft': {
    name: 'Microsoft Rewards',
    loginUrl: 'https://rewards.bing.com',
    browserDir: cfg.dir.browser,
    async checkLogin(page) {
      try {
        await page.goto('https://rewards.bing.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        const url = page.url();
        if (url.includes('login.live.com') || url.includes('login.microsoftonline.com') || url.includes('account.microsoft.com') || url.includes('/welcome')) {
          return { loggedIn: false };
        }
        const user = await readMicrosoftRewardsUser(page);
        return { loggedIn: true, user: user || 'Microsoft account' };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'microsoft-mobile': {
    name: 'Microsoft Rewards (Mobile)',
    loginUrl: 'https://rewards.bing.com',
    browserDir: cfg.dir.browser + '-mobile',
    contextOptions: devices['Pixel 7'],
    async checkLogin(page) {
      try {
        await page.goto('https://rewards.bing.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(5000); // mobile redirects settle more slowly
        const url = page.url();
        if (url.includes('login.live.com') || url.includes('login.microsoftonline.com') || url.includes('account.microsoft.com') || url.includes('/welcome')) {
          return { loggedIn: false };
        }
        // Same account as the desktop entry; the card title already says "(Mobile)",
        // so don't append it here too.
        const user = await readMicrosoftRewardsUser(page);
        return { loggedIn: true, user: user || 'Microsoft account' };
      } catch {
        return { loggedIn: false };
      }
    },
  },
};

const _sessionCache = new Map(); // siteId → { result: {loggedIn, user}, expiresAt }
const SESSION_TTL_MS = { loggedIn: 30 * 60 * 1000, loggedOut: 5 * 60 * 1000 };

export function invalidateSession(siteId) { _sessionCache.delete(siteId); }

export function checkLoginCached(siteId, page) {
  const site = SITES[siteId];
  const cached = _sessionCache.get(siteId);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.result);
  return site.checkLogin(page).then(r => {
    const ttl = r.loggedIn ? SESSION_TTL_MS.loggedIn : SESSION_TTL_MS.loggedOut;
    _sessionCache.set(siteId, { result: r, expiresAt: Date.now() + ttl });
    return r;
  });
}
