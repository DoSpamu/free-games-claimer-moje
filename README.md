<p align="center">
<img alt="logo-free-games-claimer" src="https://user-images.githubusercontent.com/493741/214588518-a4c89998-127e-4a8c-9b1e-ee4a9d075715.png" />
</p>

# free-games-claimer (feldorn fork)

Fork of [vogler/free-games-claimer](https://github.com/vogler/free-games-claimer) with a built-in **control panel**, **scheduler**, **multi-account support**, and additional services.

Claims free games/points periodically on:
- <img src="https://github.com/user-attachments/assets/82e9e9bf-b6ac-4f20-91db-36d2c8429cb6" width="32" align="middle" /> [Epic Games Store](https://www.epicgames.com/store/free-games)
- <img src="https://github.com/user-attachments/assets/7627a108-20c6-4525-a1d8-5d221ee89d6e" width="32" align="middle" /> [Amazon Prime Gaming](https://gaming.amazon.com)
- <img src="https://github.com/user-attachments/assets/49040b50-ee14-4439-8e3c-e93cafd7c3a5" width="32" align="middle" /> [GOG](https://www.gog.com)
- <img src="https://github.com/user-attachments/assets/3582444b-f23b-448d-bf31-01668cd0313a" width="32" align="middle" /> [Unreal Engine Assets](https://www.unrealengine.com/marketplace/en-US/assets?tag=4910) (same login as Epic Games)
- 🎮 [Steam](https://store.steampowered.com/search/?maxprice=free&specials=1) — claims free-to-keep games (filtered by rating/price)
- 🪟 [Microsoft Rewards](https://rewards.microsoft.com) — completes daily Bing searches for points (PC + mobile)
- 🎮 [Ubisoft](https://www.ubisoft.com) — opt-in, claims free Ubisoft Connect rewards
- 🛒 [AliExpress](https://www.aliexpress.com) — opt-in, claims daily coins

_Works on Windows/macOS/Linux._

## How to run

### Docker (recommended)

```bash
docker run --rm -it -p 6080:6080 -p 7080:7080 -v fgc:/fgc/data \
  --pull=always ghcr.io/feldorn/free-games-claimer
```

Or with Docker Compose (see `docker-compose.yml`):

```bash
docker compose up
```

| Port | Purpose |
|------|---------|
| `6080` | noVNC — browser UI inside the container for first-time login |
| `7080` | **Control panel** — scheduler, session status, library, accounts |

### Without Docker

1. [Install Node.js](https://nodejs.org/en/download)
2. Clone/download this repository and `cd` into it
3. `npm install`
4. `node interactive-login.js` — starts the control panel on port 7080
   or run a single claimer directly: `node epic-games`, `node steam`, etc.

## Control Panel (port 7080)

`node interactive-login.js` starts a persistent HTTP server at **http://localhost:7080** with tabs for:

| Tab | Description |
|-----|-------------|
| **Sessions** | Live login status for every active service; "Check All" button |
| **Library** | All claimed games with search, platform/status filter, CSV export |
| **Accounts** | Multi-account management (stored in `data/accounts.json`) |
| **Settings** | Configure scheduler, notifications, service toggles — no restart needed |
| **Logs** | Real-time output from the claim runner |

The scheduler (`LOOP` env var) runs all claimer scripts automatically and respects the **circuit breaker**: if a service fails `CIRCUIT_BREAKER_THRESHOLD` consecutive times it is suspended for `CIRCUIT_BREAKER_COOLDOWN` hours.

## First login

Open **http://localhost:6080** (noVNC) to interact with the browser inside the container and log in to each service manually. Session cookies are saved in `data/browser/` and reused on every run.

Alternatively, set credentials as env vars (see table below) and the scripts will log in automatically.

## Configuration

Options are set via environment variables, `data/config.env` (dotenv), or the **Settings** tab in the control panel.

**Precedence:** Settings tab (`data/config.json`) → `process.env` / `data/config.env` → hardcoded defaults.

Credentials (passwords, OTP keys) are **env-only** — they are never written to `data/config.json`.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOOP` | `0` | Scheduler interval in **seconds** (0 = disabled). E.g. `86400` for daily. |
| `EMAIL` | | Fallback email for all services |
| `PASSWORD` | | Fallback password for all services |
| `EG_EMAIL` / `EG_PASSWORD` / `EG_OTPKEY` | | Epic Games credentials |
| `EG_PARENTALPIN` | | Epic Games Parental Controls PIN |
| `PG_EMAIL` / `PG_PASSWORD` / `PG_OTPKEY` | | Prime Gaming (Amazon) credentials |
| `PG_REDEEM` | `0` | Try to redeem Prime Gaming keys on external stores |
| `PG_CLAIMDLC` | `0` | Try to claim DLCs from Prime Gaming |
| `PG_TIMELEFT` | | Skip offers expiring in fewer than N days |
| `GOG_EMAIL` / `GOG_PASSWORD` | | GOG credentials |
| `GOG_NEWSLETTER` | `0` | Don't unsubscribe from newsletter after claiming |
| `STEAM_EMAIL` / `STEAM_PASSWORD` / `STEAM_OTPKEY` | | Steam credentials (TOTP auto-generated from key) |
| `STEAM_MIN_RATING` | `6` | Minimum Steam review rating to claim (1–9; 6 = Mostly Positive) |
| `STEAM_MIN_PRICE` | `10` | Minimum original price in USD to claim |
| `MS_EMAIL` / `MS_PASSWORD` / `MS_OTPKEY` | | Microsoft account for Bing Rewards |
| `MS_SCHEDULE_HOURS` | `0` | How many hours `microsoft.js` should spread searches over (0 = finish quickly) |
| `MS_SCHEDULE_START` | `8` | Hour of day (0–23) to start Microsoft searches |
| `NOTIFY` | | [Apprise](https://github.com/caronc/apprise) notification URL(s) |
| `NOTIFY_TITLE` | | Optional notification title |
| `NOTIFY_ATTACH_SCREENSHOTS` | `1` | Attach screenshots to notifications |
| `TG_TOKEN` + `TG_CHAT_ID` | | Telegram bot token + chat ID for notifications with game artwork |
| `DISCORD_WEBHOOK` | | Discord webhook URL for notifications |
| `CIRCUIT_BREAKER_THRESHOLD` | `3` | Consecutive failures before a service is suspended |
| `CIRCUIT_BREAKER_COOLDOWN` | `8` | Cooldown hours before a suspended service is retried |
| `PUBLIC_URL` | | Full external URL of the panel (used in notifications) |
| `CLAIM_CMD` | all services | Shell command run by the scheduler |
| `CLAIM_CMD_MANUAL` | all except microsoft | Shell command for the "Run Now" button |
| `DRYRUN` | `0` | Navigate but skip clicking claim buttons |
| `TIMEOUT` | `60` | Page action timeout in seconds |
| `LOGIN_TIMEOUT` | `180` | Login timeout in seconds |
| `BROWSER_DIR` | `data/browser` | Browser profile directory |
| `WIDTH` / `HEIGHT` | `1920` / `1080` | Browser window size |
| `DEBUG=1` / `PWDEBUG=1` | | Non-headless mode / Playwright Inspector |

### Service on/off switches

| Variable | Default | Service |
|----------|---------|---------|
| `EG_ACTIVE` | `1` | Epic Games |
| `PG_ACTIVE` | `1` | Prime Gaming |
| `GOG_ACTIVE` | `1` | GOG |
| `STEAM_ACTIVE` | `1` | Steam |
| `MS_ACTIVE` | `1` | Microsoft Rewards (PC) |
| `MS_MOBILE_ACTIVE` | `1` | Microsoft Rewards (mobile) |
| `UBISOFT_ACTIVE` | `0` | Ubisoft (opt-in) |
| `AE_ACTIVE` | `0` | AliExpress (opt-in) |

### Automatic OTP / 2FA

Set the `*_OTPKEY` variable to the TOTP secret from the store's authenticator setup page — logins will be fully automatic, including 2FA.

- **Epic Games**: [password & security](https://www.epicgames.com/account/password) → Enable third-party authenticator → copy *Manual Entry Key*
- **Prime Gaming**: Amazon → Login & security → 2-step verification → Add new app → *Can't scan the barcode*
- **Steam**: Steam Guard → Manage authenticator → copy the secret key (or use `STEAM_OTPKEY`)
- **Microsoft**: Account → Security → Advanced security → Authenticator app setup → *Can't scan*
- **GOG**: only supports email OTP

### How to set options

**Docker:** `-e VAR=VAL` flags or `--env-file fgc.env`, or copy a file to `/fgc/data/config.env` inside the volume.

**Without Docker (Linux/macOS):** prefix variables: `EMAIL=foo@bar.baz node epic-games`

**Without Docker (Windows):** `set EMAIL=foo@bar.baz` then `node epic-games`, or put values in `data/config.env`.

**Control panel:** use the **Settings** tab — changes take effect on the next scheduled run without restarting.

## Notifications

Set `NOTIFY` to any [Apprise](https://github.com/caronc/apprise) URL (Pushover, Slack, Email, etc.), or use the dedicated `TG_TOKEN`/`TG_CHAT_ID` for Telegram (includes game artwork) or `DISCORD_WEBHOOK` for Discord.

## Multi-account support

Accounts are managed in the **Accounts** tab of the control panel or directly in `data/accounts.json`. Each account can override credentials per service.

## Scheduler / automatic runs

Set `LOOP=<seconds>` to run all claimer scripts automatically on a fixed interval. The control panel's **Logs** tab shows live output. You can also click **Run Now** for an immediate unscheduled run.

Without `LOOP`, you can still use external schedulers (cron, Task Scheduler, pm2) to run the individual scripts.

## Development

```bash
npm test          # run all tests (node:test, no external deps)
npm run lint      # ESLint
node --test test/util.test.js  # run a single test file
```

## Problems?

Check the [issues](https://github.com/vogler/free-games-claimer/issues) on the upstream repo or open one here.

Use `PWDEBUG=1` to open the Playwright Inspector and step through any script.

---

Based on [vogler/free-games-claimer](https://github.com/vogler/free-games-claimer).

![logo-fgc](https://user-images.githubusercontent.com/493741/214589922-093d6557-6393-421c-b577-da58ff3671bc.png)
