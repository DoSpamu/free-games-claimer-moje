import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from '../config.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PANEL_PORT = Number(process.env.PANEL_PORT) || 7080;
const NOVNC_PORT = process.env.NOVNC_PORT || 6080;
const BASE_PATH = cfg.base_path;
const PUBLIC_URL = cfg.public_url || `http://localhost:${PANEL_PORT}${BASE_PATH}`;
const LOOP_SECONDS = cfg.loop;
const MS_SCHEDULE_START = cfg.ms_schedule_start;
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(__dir, '../../package.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();

export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in — Feldorn's Free Games Claimer</title>
<link rel="icon" type="image/x-icon" href="${BASE_PATH}/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="${BASE_PATH}/assets/icon-32.png">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; align-items: center; justify-content: center; }
  .login-box { background: #16213e; padding: 40px; border-radius: 12px; border: 1px solid #0f3460; width: 360px; text-align: center; }
  .login-box h1 { color: #e94560; margin-bottom: 8px; font-size: 22px; }
  .login-box p { color: #888; margin-bottom: 24px; font-size: 14px; }
  .login-box input { width: 100%; padding: 10px 14px; border-radius: 6px; border: 1px solid #0f3460; background: #1a1a2e; color: #e0e0e0; font-size: 14px; margin-bottom: 16px; }
  .login-box button { width: 100%; padding: 10px; border-radius: 6px; border: none; background: #e94560; color: white; font-size: 14px; font-weight: 600; cursor: pointer; }
  .login-box button:hover { background: #d63851; }
  .error { color: #e94560; font-size: 13px; margin-bottom: 12px; display: none; }
</style></head><body>
<div class="login-box">
  <h1>Free Games Claimer</h1>
  <p>Enter the panel password to continue.</p>
  <div class="error" id="error">Incorrect password.</div>
  <input type="password" id="pw" placeholder="Password" autofocus>
  <button onclick="login()">Login</button>
</div>
<script>
document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
async function login() {
  const pw = document.getElementById('pw').value;
  const r = await fetch('${BASE_PATH}/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const j = await r.json();
  if (j.success) { location.reload(); }
  else { document.getElementById('error').style.display = 'block'; }
}
</script></body></html>`;

export const PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Feldorn's Free Games Claimer</title>
<link rel="icon" type="image/x-icon" href="${BASE_PATH}/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="${BASE_PATH}/assets/icon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="${BASE_PATH}/assets/icon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="${BASE_PATH}/assets/icon-192.png">
<link rel="apple-touch-icon" sizes="192x192" href="${BASE_PATH}/assets/icon-192.png">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }

  .header { background: #16213e; padding: 12px 20px 14px; border-bottom: 2px solid #0f3460; flex-shrink: 0; position: relative; }
  .header h1 { display: flex; align-items: center; gap: 10px; }
  .header h1 img { height: 32px; width: 32px; flex-shrink: 0; }
  .header-collapse { position: absolute; right: 10px; bottom: 2px; background: transparent; border: none; color: #a0b4d4; opacity: 0.6; cursor: pointer; padding: 2px 6px; font-size: 13px; line-height: 1; font-family: inherit; }
  .header-collapse:hover { opacity: 1; color: #e0e0e0; }
  .compact-sessions { display: none; flex-wrap: wrap; gap: 6px; padding: 4px 0 0; }
  body[data-tab="sessions"] .compact-sessions.shown { display: flex; cursor: pointer; }
  .compact-sessions.shown:hover .mini-card { filter: brightness(1.15); }
  .compact-sessions .mini-card { display: inline-flex; align-items: center; gap: 5px; background: #1e2a47; padding: 3px 9px; border-radius: 4px; font-size: 12px; color: #a0b4d4; }
  .compact-sessions .mini-card .mini-glyph { font-weight: 600; }
  .compact-sessions .mini-card.logged-in     .mini-glyph { color: #4ecca3; }
  .compact-sessions .mini-card.not-logged-in .mini-glyph { color: #e94560; }
  .compact-sessions .mini-card.error         .mini-glyph { color: #f0c040; }
  .compact-sessions .mini-card.unknown       .mini-glyph { color: #888; }
  .captcha-banner { background: #2a1a1e; border: 1px solid #e94560; color: #e94560; padding: 10px 14px; border-radius: 6px; margin: 6px 0; display: flex; align-items: center; gap: 12px; cursor: pointer; }
  .captcha-banner:hover { filter: brightness(1.2); }
  .captcha-banner .cb-icon { font-size: 18px; flex-shrink: 0; }
  .captcha-banner .cb-text { flex: 1; font-weight: 500; line-height: 1.35; }
  .captcha-banner .cb-cta  { font-weight: 600; opacity: 0.9; white-space: nowrap; }
  .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .header h1 { font-size: 18px; color: #e94560; white-space: nowrap; }
  .header-actions { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }

  .tab-nav { display: flex; gap: 2px; }
  .tab-nav .tab { padding: 5px 12px; background: transparent; color: #a0a0c0; font-size: 13px; cursor: pointer; border: none; border-radius: 6px; font-weight: 500; }
  .tab-nav .tab:hover { background: #1a2a4a; color: #e0e0e0; }
  .tab-nav .tab.active { background: #0f3460; color: #fff; }

  .tab-panel { display: none; }
  .tab-panel.stub { padding: 40px; color: #8aa0c2; text-align: center; line-height: 1.7; }
  .tab-panel.stub h2 { color: #e0e0e0; margin-bottom: 10px; font-size: 18px; }
  .tab-panel.stub p { font-size: 14px; max-width: 480px; margin: 0 auto; }
  body[data-tab="sessions"] .tab-panel[data-panel="sessions"] { display: flex; flex: 1; flex-direction: column; }
  body[data-tab="stats"] .tab-panel[data-panel="stats"] { display: block; overflow-y: auto; padding: 24px 32px; }
  body[data-tab="schedule"] .tab-panel[data-panel="schedule"] { display: block; overflow-y: auto; padding: 28px 32px; }
  body[data-tab="logs"] .tab-panel[data-panel="logs"] { display: flex; flex: 1; flex-direction: column; }
  body[data-tab="settings"] .tab-panel[data-panel="settings"] { display: flex; flex: 1; flex-direction: column; position: relative; }
  body[data-tab="environment"] .tab-panel[data-panel="environment"] { display: flex; flex: 1; flex-direction: column; }
  body[data-tab="library"] .tab-panel[data-panel="library"] { display: block; }
  body[data-tab="accounts"] .tab-panel[data-panel="accounts"] { display: block; overflow-y: auto; padding: 24px 32px; }

  .settings-layout { flex: 1; display: grid; grid-template-columns: 180px 1fr; min-height: 0; }
  .settings-rail { background: #12213a; border-right: 1px solid #233454; padding: 14px 0; overflow-y: auto; display: flex; flex-direction: column; }
  .settings-rail .rail-btn { display: block; width: 100%; text-align: left; padding: 9px 18px; background: transparent; border: none; border-left: 3px solid transparent; color: #a0b4d4; font-size: 13px; cursor: pointer; font-family: inherit; }
  .settings-rail .rail-btn:hover { background: #1a2a48; color: #e0e0e0; }
  .settings-rail .rail-btn.active { background: rgba(78, 204, 163, 0.08); color: #fff; border-left-color: #4ecca3; font-weight: 600; }
  .settings-rail-version { margin-top: auto; padding: 12px 18px 4px; font-size: 13px; color: #6a7e9d; font-variant-numeric: tabular-nums; }
  .settings-pane { overflow-y: auto; padding: 24px 32px 24px; }
  /* Cap the settings content to a comfortable form width (Strategy A from the
     UX brief). Stretching label/control pairs across the full 1900px panel
     hurts pairing — eye has to track too far. 720px matches GitHub/Linear/
     Stripe-style settings pages. */
  .settings-pane > * { max-width: 720px; }
  .settings-pane-title { font-size: 11px; color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
  .settings-pane-title .spacer { flex: 1; }

  /* Keep the old class names working for in-section rendering */
  .settings-view { flex: 1; overflow-y: auto; padding: 24px 32px 16px; }
  .settings-section { margin-bottom: 28px; }
  .settings-section-head { font-size: 11px; color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; display: flex; align-items: center; gap: 12px; }
  .settings-section-head .spacer { flex: 1; }

  @media (max-width: 720px) {
    .settings-layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    .settings-rail { display: flex; flex-direction: row; overflow-x: auto; gap: 4px; padding: 8px 12px; border-right: none; border-bottom: 1px solid #233454; }
    .settings-rail .rail-btn { width: auto; flex-shrink: 0; white-space: nowrap; border-left: none; border-bottom: 3px solid transparent; border-radius: 6px; padding: 6px 12px; }
    .settings-rail .rail-btn.active { border-left-color: transparent; border-bottom-color: #4ecca3; }
    .settings-rail-version { margin-top: 0; margin-left: auto; align-self: center; padding: 0 8px; }
    .settings-pane { padding: 16px; }
  }

  .env-view-head { padding: 20px 32px 8px; display: flex; align-items: flex-start; gap: 16px; flex-shrink: 0; }
  .env-view-head .env-view-title { font-size: 16px; color: #e0e0e0; font-weight: 600; margin: 0 0 4px; }
  .env-view-head .env-view-sub { font-size: 12px; color: #8aa0c2; line-height: 1.45; max-width: 540px; }
  .env-view-head > button { margin-left: auto; flex-shrink: 0; }
  .env-view-body { flex: 1; overflow-y: auto; padding: 0 32px 24px; }

  /* Field chrome */
  /* Label uses normal text flow; the (i) icon glues to the last word via an
     inline-flex tail (atomic unit, can't break internally). gap handles the
     spacing so the icons null out their own margin-left inside the tail to
     avoid doubled-up spacing. */
  .setting .setting-help-popover { grid-column: 1 / -1; }
  .setting-label-tail { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; vertical-align: baseline; }
  .setting-label-tail .setting-info { flex-shrink: 0; margin-left: 0; }
  .setting-label-tail .setting-dot { flex-shrink: 0; margin-left: 0; }
  /* Currency / unit prefix sits inside the input box (absolute-positioned)
     instead of as a separate flex item — so the $ visually attaches to the
     value rather than floating in its own micro-column. */
  .setting-input .input-with-prefix { position: relative; display: inline-block; flex: 0 0 auto; }
  .setting-input .input-with-prefix .input-prefix { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #8aa0c2; font-size: 13px; pointer-events: none; }
  .setting-input .input-with-prefix input[type="number"] { padding-left: 22px; }
  .setting-info { background: transparent; border: 1px solid #233454; color: #8aa0c2; width: 18px; height: 18px; border-radius: 50%; font-size: 11px; cursor: pointer; padding: 0; line-height: 1; margin-left: 6px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; }
  .setting-info:hover { background: #1a2a48; color: #e0e0e0; border-color: #2a3a5a; }
  .setting-info.open { background: #0f3460; color: #fff; border-color: #4ecca3; }
  .setting-help-popover { margin-top: 4px; padding: 8px 10px; background: #0d1830; border: 1px solid #233454; border-radius: 6px; font-size: 12px; color: #a0b4d4; line-height: 1.5; display: none; }
  .setting-help-popover.open { display: block; }
  .setting-help-popover .env-tag { font-family: 'Menlo', 'Consolas', monospace; font-size: 11px; color: #8aa0c2; display: block; margin-top: 4px; }

  /* Per-service accordion */
  .svc-row { border-top: 1px solid #1a2a48; }
  .svc-row:first-of-type { border-top: none; }
  /* Strategy A: the expand button sizes to its content (no flex:1) so the
     master toggle lands ~16px after the count pill, not the far-right edge. */
  .svc-head { display: flex; align-items: center; gap: 16px; }
  .svc-expand { display: grid; grid-template-columns: 14px 1fr; grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; padding: 12px 12px; cursor: pointer; background: transparent; border: none; color: inherit; font-family: inherit; text-align: left; transition: background 0.12s, box-shadow 0.12s; }
  .svc-row.expandable .svc-expand:hover { background: rgba(78, 204, 163, 0.05); box-shadow: inset 3px 0 0 #4ecca3; }
  .svc-expand[disabled] { cursor: default; }
  .svc-expand .svc-caret { grid-row: 1 / 3; grid-column: 1; align-self: center; color: #8aa0c2; font-size: 13px; }
  .svc-expand .svc-caret.svc-caret-disabled { opacity: 0.3; }
  .svc-expand .svc-name-line { grid-row: 1; grid-column: 2; display: flex; align-items: baseline; gap: 10px; }
  .svc-expand .svc-name { font-size: 15px; font-weight: 600; color: #ffffff; letter-spacing: 0.01em; }
  .svc-expand .svc-count { font-size: 11px; color: #6a7e9e; font-weight: 400; letter-spacing: 0.02em; padding: 2px 7px; border: 1px solid #233454; border-radius: 10px; line-height: 1; }
  .svc-row.expandable .svc-expand:hover .svc-count { color: #4ecca3; border-color: #2a4a3e; }
  .svc-expand .svc-summary { grid-row: 2; grid-column: 2; font-size: 12.5px; color: #8aa0c2; line-height: 1.4; }
  .svc-row.inactive .svc-name { color: #c0c8d8; font-weight: 500; }
  .svc-row.inactive .svc-summary { color: #6a7e9e; }
  /* Per-service master toggle — a real switch, not a checkbox. Different
     semantic from sub-boolean settings inside the expanded body. */
  .svc-toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
  .svc-toggle input[type="checkbox"] { position: absolute; opacity: 0; pointer-events: none; }
  .svc-toggle-track { width: 32px; height: 18px; background: #233454; border-radius: 9px; position: relative; transition: background 0.15s; flex-shrink: 0; }
  .svc-toggle-thumb { width: 14px; height: 14px; background: #c0c8d8; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: left 0.15s, background 0.15s; }
  .svc-toggle input[type="checkbox"]:checked + .svc-toggle-track { background: #4ecca3; }
  .svc-toggle input[type="checkbox"]:checked + .svc-toggle-track .svc-toggle-thumb { left: 16px; background: #fff; }
  .svc-toggle:hover .svc-toggle-track { box-shadow: 0 0 0 3px rgba(78, 204, 163, 0.12); }
  /* Expanded sub-settings: 2px accent left border + indent so the parent/child
     relationship is visually obvious. Border sits ~under the caret (toggle
     32 + gap 16 + expand-padding 12 + half-caret 7 = 67px), and content
     padding aligns the body with the service name (caret-col 14 + col-gap 12
     past the border = 86px). */
  .svc-body { display: none; margin-left: 66px; padding: 6px 12px 16px 18px; border-left: 2px solid rgba(78, 204, 163, 0.35); }
  .svc-body.open { display: block; }
  .svc-body .svc-subtitle { font-size: 12px; color: #8aa0c2; margin: 0 0 12px; font-style: italic; }
  /* Strategy A layout: label takes only the space it needs and the control
     sits ~24px to its right. No more stretched grid pushing controls to a
     far-edge column. flex-wrap allows revert + popover to wrap onto extra
     rows when needed. */
  .setting { display: flex; align-items: center; gap: 24px; padding: 12px 0; border-bottom: 1px solid #1a2a48; flex-wrap: wrap; }
  .setting:last-child { border-bottom: none; }
  .setting > .setting-label { flex: 0 0 auto; white-space: nowrap; min-width: 0; }
  .setting > .setting-input { flex: 0 0 auto; }
  .setting > .setting-help-popover { flex-basis: 100%; }
  /* Below 640px: labels wrap naturally and controls drop below.
     Boolean Variant C keeps its checkbox-left inline layout. */
  @media (max-width: 640px) {
    .setting:not(.setting-bool) { flex-direction: column; align-items: flex-start; gap: 8px; }
    .setting:not(.setting-bool) > .setting-label { white-space: normal; }
  }
  /* Grouped fields: small-caps subheader replaces the per-field hairline so
     related settings (Timeouts, Debug, Viewport, etc.) read as one cluster. */
  .setting-group { margin-bottom: 24px; }
  .setting-group:last-child { margin-bottom: 0; }
  .setting-group-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7e9e; margin: 0 0 4px; padding-bottom: 6px; border-bottom: 1px solid #1a2a48; }
  .setting-group .setting { border-bottom: none; padding: 8px 0; }
  .setting-label { font-size: 13px; color: #e0e0e0; line-height: 1.4; }
  .setting-env { font-size: 11px; color: #8aa0c2; font-family: 'Menlo', 'Consolas', monospace; margin-left: 6px; }
  .setting-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ecca3; display: inline-block; margin-left: 6px; vertical-align: middle; }
  .setting-hint { font-size: 11px; color: #8aa0c2; margin-top: 3px; line-height: 1.4; font-style: italic; }
  .setting-input { display: flex; align-items: center; gap: 8px; }
  .setting-input input[type="number"], .setting-input input[type="text"], .setting-input select, .setting-input textarea {
    background: #0d1830; color: #e0e0e0; border: 1px solid #233454; border-radius: 4px; padding: 6px 8px; font-size: 13px; font-family: inherit;
  }
  /* Default widths by control type — Strategy A's flex layout means inputs
     don't auto-fill a stretched column anymore, so each gets a sensible
     content-width that matches the typical input length. */
  .setting-input input[type="text"] { width: 320px; max-width: 100%; }
  .setting-input textarea { width: 480px; max-width: 100%; }
  .setting-input select { min-width: 120px; }
  /* Numeric inputs: cap width and right-align so "60" doesn't share the same
     stretched width as a long Apprise URL. The unit suffix sits to the right. */
  .setting-input input[type="number"] { width: 110px; flex: 0 0 auto; text-align: right; }
  .setting-input .input-suffix { color: #8aa0c2; font-size: 12px; white-space: nowrap; }
  .setting-input input[type="number"]:focus, .setting-input input[type="text"]:focus, .setting-input select:focus, .setting-input textarea:focus {
    outline: none; border-color: #4ecca3;
  }
  .setting-input textarea { min-height: 60px; resize: vertical; font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; }
  /* Variant C: boolean fields render as one inline cluster (checkbox-left + label),
     not the default label/input two-column grid — the whole row is one click target. */
  .setting.setting-bool { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 0; }
  .setting.setting-bool .setting-bool-cluster { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; color: #e0e0e0; font-size: 13px; line-height: 1.4; }
  .setting.setting-bool .setting-bool-cluster input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; margin: 0; flex-shrink: 0; }
  .setting.setting-bool .setting-revert { margin-top: 0; margin-left: auto; }
  .setting.setting-bool .setting-help-popover { flex-basis: 100%; }
  .setting-revert { background: transparent; border: 1px solid #233454; border-radius: 4px; padding: 5px 10px; color: #8aa0c2; cursor: pointer; font-size: 11px; white-space: nowrap; margin-top: 3px; }
  .setting-revert:hover:not(:disabled) { background: #1a2a48; color: #e0e0e0; border-color: #2a3a5a; }
  .setting-revert:disabled { opacity: 0.25; cursor: not-allowed; }

  .settings-footer { background: #16233c; border-top: 1px solid #233454; padding: 12px 32px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .settings-footer .dirty-count { color: #f0c040; font-size: 13px; margin-right: auto; font-weight: 500; }

  .settings-subhead { font-size: 12px; color: #c0c8d8; font-weight: 600; margin: 14px 0 4px; padding-top: 10px; border-top: 1px solid #1a2a48; display: flex; align-items: center; gap: 12px; }
  .settings-subhead:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
  .settings-active-toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: #8aa0c2; font-size: 12px; font-weight: 400; cursor: pointer; text-transform: none; letter-spacing: 0; }
  .settings-active-toggle input { width: 14px; height: 14px; cursor: pointer; }
  .settings-subflag-placeholder { font-size: 11px; color: #8aa0c2; font-style: italic; padding: 10px 0 6px; margin-left: 4px; }

  .env-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  .env-table th, .env-table td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #1a2a48; vertical-align: top; }
  .env-table th { color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; font-size: 10px; }
  .env-table tr.cat-row td { padding-top: 14px; padding-bottom: 4px; border-bottom: none; color: #8aa0c2; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .env-table tr.cat-row:first-child td { padding-top: 4px; }
  .env-table tr.group-row td { padding: 8px 8px 3px; border-bottom: none; color: #c0c8d8; font-size: 11px; font-weight: 600; padding-left: 20px; }
  .env-table tr.data-row td { padding-left: 8px; }
  .env-table tr.data-row.grouped td:first-child { padding-left: 28px; }
  .env-note { font-size: 10px; color: #8aa0c2; font-style: italic; margin-top: 3px; line-height: 1.45; max-width: 420px; }
  .env-name { font-family: 'Menlo', 'Consolas', monospace; color: #c0c8d8; white-space: nowrap; }
  .env-value { font-family: 'Menlo', 'Consolas', monospace; color: #4ecca3; word-break: break-all; }
  .env-masked { font-family: 'Menlo', 'Consolas', monospace; color: #f0c040; }
  .env-unset { color: #666; font-style: italic; }
  .env-set-badge { color: #4ecca3; font-size: 11px; font-style: italic; }
  body:not([data-tab="sessions"]) .sessions-only { display: none !important; }

  .stats-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .kpi { background: #16233c; border: 1px solid #233454; border-radius: 8px; padding: 14px 16px; }
  .kpi .kpi-label { font-size: 11px; color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.06em; }
  .kpi .kpi-value { font-size: 28px; font-weight: 500; color: #fff; margin-top: 6px; line-height: 1.15; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; font-synthesis: none; }
  .kpi .kpi-hint { font-size: 12px; color: #8aa0c2; margin-top: 6px; line-height: 1.4; }

  .stats-section { margin-top: 24px; }
  .stats-section-title { font-size: 11px; color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }

  .stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .stats-table th, .stats-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #233454; }
  .stats-table th { font-size: 11px; color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
  .stats-table th.num, .stats-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .stats-table th.ts,  .stats-table td.ts  { text-align: left;  font-variant-numeric: tabular-nums; }
  .stats-table td.muted.note { text-align: right; }
  .stats-table .muted { color: #8aa0c2; font-style: italic; }

  .stats-chart-wrap { background: #0d1830; border-radius: 6px; padding: 10px 12px; }
  .chart-plot { display: flex; gap: 8px; }
  .chart-y-axis { display: flex; flex-direction: column-reverse; justify-content: space-between; font-size: 10px; color: #8aa0c2; padding-bottom: 20px; min-width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
  .chart-area { flex: 1; min-width: 0; }
  .chart-bars { display: flex; align-items: flex-end; gap: 2px; height: 120px; border-bottom: 1px solid #233454; }
  .chart-bars .bar { flex: 1; min-width: 0; background: #4ecca3; min-height: 2px; border-radius: 2px 2px 0 0; }
  .chart-bars .bar.zero { background: #4a5a8a; }
  .chart-x-axis { display: flex; gap: 2px; font-size: 10px; color: #8aa0c2; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .chart-x-axis .xtick { flex: 1; text-align: center; white-space: nowrap; min-width: 0; }

  .stats-activity { display: flex; flex-direction: column; gap: 4px; }
  .stats-activity .act { display: grid; grid-template-columns: 110px 160px 1fr; gap: 12px; padding: 8px 10px; background: #16233c; border-radius: 6px; font-size: 13px; align-items: center; }
  .stats-activity .act .at { color: #8aa0c2; font-size: 12px; font-variant-numeric: tabular-nums; }
  .stats-activity .act .svc { color: #4ecca3; font-weight: 500; }
  .stats-activity .act .title { color: #e0e0e0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stats-activity .act .title a,
  .stats-activity .act .title a:hover,
  .stats-activity .act .title a:visited,
  .stats-activity .act .title a:active { color: inherit; text-decoration: none; }
  .stats-empty { color: #8aa0c2; font-style: italic; padding: 20px; text-align: center; background: #16233c; border-radius: 6px; }

  .sched-row { display: flex; gap: 24px; margin-bottom: 22px; align-items: baseline; }
  .sched-label { font-size: 11px; color: #8aa0c2; text-transform: uppercase; letter-spacing: 0.06em; min-width: 110px; flex-shrink: 0; padding-top: 4px; }
  .sched-value { font-size: 15px; color: #e0e0e0; line-height: 1.5; }
  .sched-value.big { font-size: 26px; font-weight: 600; color: #fff; display: block; margin-bottom: 2px; }
  .sched-value.muted { color: #8aa0c2; font-style: italic; }
  .sched-count { font-size: 13px; color: #4ecca3; }
  .sched-note { margin-top: 28px; padding-top: 16px; border-top: 1px solid #233454; color: #8aa0c2; font-size: 13px; line-height: 1.6; }
  .sched-services { list-style: none; margin: 0; padding: 0; font-size: 13px; color: #c8d0dc; line-height: 1.75; }
  .sched-services li { position: relative; padding-left: 16px; }
  .sched-services li::before { content: '•'; position: absolute; left: 0; color: #4ecca3; font-weight: 700; }
  .sched-services b { color: #ffffff; font-weight: 600; }
  .sched-services .muted { color: #8aa0c2; font-weight: 400; font-size: 12px; }

  .logs-header { padding: 10px 20px; border-bottom: 1px solid #0f3460; font-size: 13px; color: #8aa0c2; flex-shrink: 0; display: flex; align-items: center; gap: 12px; }
  .logs-header .logs-count { margin-left: auto; font-size: 12px; }
  .logs-body { flex: 1; background: #0d0d1a; font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; padding: 12px 16px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  .logs-body .line { padding: 1px 0; }
  .logs-body .line.stderr { color: #e94560; }
  .logs-body .line.stdout { color: #c0c0d0; }
  .logs-body .line.system { color: #f0c040; font-weight: 600; }
  .logs-body .time { color: #555; margin-right: 8px; }
  .logs-empty { color: #8aa0c2; font-style: italic; padding: 40px; text-align: center; }

  .steps { display: flex; gap: 4px; align-items: center; font-size: 12px; color: #888; margin-bottom: 10px; flex-wrap: wrap; }
  .step { padding: 4px 10px; border-radius: 12px; background: #0f3460; white-space: nowrap; }
  .step.active { background: #e94560; color: white; }
  .step.done { background: #4ecca3; color: #1a1a2e; }
  .step.waiting { background: #2a2a4e; color: #f0c040; }
  .step-arrow { color: #555; }

  .status-strip { display: none; align-items: center; gap: 10px; padding: 6px 12px; font-size: 13px; line-height: 1.35; border-radius: 6px; margin-bottom: 8px; cursor: pointer; }
  .status-strip:hover { filter: brightness(1.1); }
  .status-strip.ok   { background: #0e2a1f; color: #4ecca3; }
  .status-strip.warn { background: #2a2a1e; color: #f0c040; }
  .status-strip.err  { background: #2a1a1e; color: #e94560; }
  .status-strip.info { background: #12203a; color: #a0b4d4; }
  .status-strip .strip-primary   { font-weight: 500; }
  .status-strip .strip-secondary { margin-left: auto; opacity: 0.72; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .site-cards { display: grid; grid-template-columns: repeat(1, 1fr); gap: 10px; }
  @media (min-width: 640px)  { .site-cards { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 960px)  { .site-cards { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1400px) { .site-cards { grid-template-columns: repeat(4, 1fr); } }
  .site-card { background: #0f3460; border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; min-height: 110px; }
  .site-card.card-inactive { background: #12213a; border: 1px dashed #2a3a5a; opacity: 0.85; }
  .site-card.card-inactive .name { color: #a0b4d4; }
  .site-card.card-inactive .status { color: #8aa0c2; font-style: italic; }

  .available-drawer { margin-top: 12px; background: #12213a; border: 1px solid #233454; border-radius: 8px; }
  .available-drawer .drawer-head { width: 100%; text-align: left; padding: 10px 14px; background: transparent; border: none; color: #a0b4d4; font-size: 13px; cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 8px; }
  .available-drawer .drawer-head:hover { color: #e0e0e0; }
  .available-drawer .drawer-head .caret { display: inline-block; width: 12px; }
  .available-drawer .drawer-body { padding: 0 14px 12px; display: grid; grid-template-columns: repeat(1, 1fr); gap: 10px; }
  /* The .drawer-body rule above sets display:grid, which beats the UA default
     [hidden]{display:none} on specificity — without this override, toggling
     the caret flipped the hidden attribute but the cards stayed visible. */
  .available-drawer .drawer-body[hidden] { display: none; }
  @media (min-width: 640px)  { .available-drawer .drawer-body { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 960px)  { .available-drawer .drawer-body { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1400px) { .available-drawer .drawer-body { grid-template-columns: repeat(4, 1fr); } }
  .site-card-header { display: flex; align-items: center; gap: 8px; }
  .site-card .name { font-weight: 600; font-size: 14px; }
  .site-card .status { font-size: 12px; color: #888; flex: 1; }
  .site-card .status.logged-in { color: #4ecca3; }
  .site-card .status.not-logged-in { color: #e94560; }
  .site-card .status.checking { color: #f0c040; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .dot.unknown { background: #555; }
  .dot.logged-in { background: #4ecca3; }
  .dot.not-logged-in { background: #e94560; }
  .dot.checking { background: #f0c040; animation: pulse 1s infinite; }
  .dot.error { background: #ff6b6b; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .card-actions { display: flex; gap: 6px; margin-left: auto; }
  .site-card .card-actions { margin-left: 0; margin-top: auto; }
  .site-card .card-actions > .btn { flex: 1; padding: 7px 10px; }
  .btn { border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; font-weight: 500; transition: background 0.2s, transform 0.1s; }
  .btn:active { transform: scale(0.97); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-login { background: #e94560; color: white; }
  .btn-login:hover:not(:disabled) { background: #d63851; }
  .btn-check { background: #3a3a5c; color: #ccc; }
  .btn-check:hover:not(:disabled) { background: #4a4a6c; }
  .btn-check-all { background: #3a3a5c; color: #ccc; }
  .btn-check-all:hover:not(:disabled) { background: #4a4a6c; }
  .btn-show-browser { background: #3a3a5c; color: #ccc; }
  .btn-show-browser:hover:not(:disabled) { background: #4a4a6c; }
  .btn-show-browser.active { background: #2a4a3e; color: #4ecca3; }
  .btn-popout-browser { background: #3a3a5c; color: #ccc; }
  .btn-popout-browser:hover:not(:disabled) { background: #4a4a6c; }
  .btn-run-single { background: #2a4a3e; color: #4ecca3; }
  .btn-run-single:hover:not(:disabled) { background: #3a5a4e; color: #5edcb3; }
  .btn-run { background: #4ecca3; color: #1a1a2e; font-weight: 600; }
  .btn-run:hover:not(:disabled) { background: #3dbb92; }
  .btn-stop { background: #e94560; color: white; }
  .btn-stop:hover:not(:disabled) { background: #d63851; }
  .btn-verify { background: #4ecca3; color: #1a1a2e; font-weight: 600; }
  .btn-verify:hover:not(:disabled) { background: #3dbb92; }
  .btn-cancel { background: #555; color: #ccc; }
  .btn-cancel:hover:not(:disabled) { background: #666; }

  .active-session { background: #1a3a2e; border: 1px solid #4ecca3; border-radius: 8px; padding: 10px 16px; display: flex; align-items: center; gap: 12px; margin-top: 10px; }
  .active-session .label { color: #4ecca3; font-weight: 600; font-size: 14px; }
  .active-session .site-name { color: #fff; font-size: 14px; }

  .main-area { flex: 1; position: relative; display: flex; flex-direction: column; }
  .vnc-container { flex: 1; position: relative; }
  .vnc-container iframe { width: 100%; height: 100%; border: none; }
  .vnc-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 15px; text-align: center; padding: 40px; line-height: 1.8; }
  .vnc-placeholder b { color: #e94560; }
  .vnc-placeholder .highlight { color: #4ecca3; }

  .run-log { flex: 1; background: #0d0d1a; font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; padding: 12px 16px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  .run-log .line { padding: 1px 0; }
  .run-log .line.stderr { color: #e94560; }
  .run-log .line.stdout { color: #c0c0d0; }
  .run-log .line.system { color: #f0c040; font-weight: 600; }
  .run-log .time { color: #555; margin-right: 8px; }

  .toast { position: fixed; bottom: 20px; right: 20px; background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 12px 20px; font-size: 14px; z-index: 100; animation: slideIn 0.3s ease; max-width: 400px; }
  .toast.success { border-color: #4ecca3; }
  .toast.error { border-color: #e94560; }
  .toast.info { border-color: #f0c040; }
  @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

  /* Tablet (iPad): header-top wraps, step chips stay on their own row */
  @media (max-width: 900px) {
    .header-top { flex-wrap: wrap; row-gap: 8px; }
    .header-actions { margin-left: auto; }
  }

  /* Landscape tablet / large phone */
  @media (max-width: 700px) {
    .header h1 { font-size: 16px; }
    .btn { padding: 6px 10px; font-size: 12px; }
  }

  /* Phone portrait */
  @media (max-width: 480px) {
    .header { padding: 10px 14px; }
    .active-session { flex-wrap: wrap; }
    .active-session .card-actions { width: 100%; justify-content: flex-end; }
  }
</style>
</head>
<body data-tab="sessions">
<div class="header">
  <div class="header-top">
    <h1><img src="${BASE_PATH}/assets/icon-64.png" alt=""><span>Feldorn's Free Games Claimer</span></h1>
    <nav class="tab-nav">
      <button class="tab active" data-tab="sessions" onclick="switchTab('sessions')">Sessions</button>
      <button class="tab" data-tab="stats" onclick="switchTab('stats')">Stats</button>
      <button class="tab" data-tab="schedule" onclick="switchTab('schedule')">Schedule</button>
      <button class="tab" data-tab="logs" onclick="switchTab('logs')">Logs</button>
      <button class="tab" data-tab="settings" onclick="switchTab('settings')">Settings</button>
      <button class="tab" data-tab="environment" onclick="switchTab('environment')">Environment</button>
      <button class="tab" data-tab="library" onclick="switchTab('library')">Library</button>
      <button class="tab" data-tab="accounts" onclick="switchTab('accounts')">Accounts</button>
    </nav>
    <div class="header-actions">
      <button class="btn btn-check-all sessions-only" onclick="checkAll()" id="btnCheckAll">Check All Sessions</button>
      <button class="btn btn-show-browser sessions-only" onclick="toggleBrowserView()" id="btnShowBrowser" title="Open the live browser view via noVNC — useful for diagnosing card-click failures or peeking at what a script is doing.">Show browser</button>
      <button class="btn btn-popout-browser sessions-only" onclick="popoutBrowser()" id="btnPopoutBrowser" title="Open the noVNC view in a new tab for full-screen viewing.">Pop out ↗</button>
      <button class="btn btn-run" onclick="runAll()" id="btnRunAll">Run Now</button>
    </div>
  </div>
  <div class="captcha-banner" id="captchaBanner" style="display:none" onclick="focusCaptcha()" title="Open the browser to solve the pending captcha"></div>
  <div class="steps sessions-only" id="steps"></div>
  <div class="status-strip sessions-only" id="statusStrip" onclick="toggleSessionsCollapsed()" title="Click to collapse session details"></div>
  <div class="site-cards sessions-only" id="siteCards"></div>
  <div class="available-drawer sessions-only" id="availableDrawer" style="display:none"></div>
  <div class="sessions-only" id="batchRedeemInfo" style="display:none; margin-top: 10px;"></div>
  <div class="sessions-only" id="activeSession" style="display:none"></div>
  <div class="compact-sessions sessions-only" id="compactSessions" onclick="toggleSessionsCollapsed()" title="Click to expand session details"></div>
  <button class="header-collapse sessions-only" id="btnHeaderCollapse" onclick="toggleSessionsCollapsed()" title="Collapse session details" aria-label="Collapse session details">▴</button>
</div>
<div id="cred-warn" style="display:none;background:#7c2d12;color:#fed7aa;padding:10px 14px;font-size:13px;position:sticky;top:0;z-index:50">
  Credentials stored in data/accounts.json — ensure this file is not publicly accessible.
  For better security, use environment variables or Docker secrets instead.
  <button onclick="this.parentElement.style.display='none'" style="float:right;background:none;border:none;color:#fed7aa;cursor:pointer;font-size:16px">×</button>
</div>
<div class="main-area" id="mainArea">
  <div class="tab-panel" data-panel="sessions">
    <div class="vnc-container" id="vncContainer">
      <div class="vnc-placeholder" id="vncPlaceholder">
        <div style="max-width:520px;font-size:14px;line-height:1.7;color:#a0b4d4">Loading…</div>
      </div>
    </div>
  </div>
  <div class="tab-panel" data-panel="stats">
    <div class="stats-kpis" id="statsKpis"></div>
    <div class="stats-section">
      <div class="stats-section-title">Per service</div>
      <table class="stats-table" id="statsTable"></table>
    </div>
    <div class="stats-section">
      <div class="stats-section-title" id="chartSectionTitle">Claims over the last 30 days</div>
      <div class="stats-chart-wrap" id="chartArea"></div>
    </div>
    <div class="stats-section">
      <div class="stats-section-title">Recent claims</div>
      <div class="stats-activity" id="statsActivity"></div>
    </div>
  </div>
  <div class="tab-panel" data-panel="schedule">
    <div id="schedView"></div>
  </div>
  <div class="tab-panel" data-panel="logs">
    <div class="logs-header">
      <span>Run output from claim scripts</span>
      <span class="logs-count" id="logsCount"></span>
    </div>
    <div class="logs-body" id="logsBody">
      <div class="logs-empty">No run activity yet. The log will populate during a manual Run Now or scheduled run.</div>
    </div>
  </div>
  <div class="tab-panel" data-panel="settings">
    <div class="settings-layout">
      <nav class="settings-rail" id="settingsRail">
        <button class="rail-btn active" data-section="scheduler"     onclick="selectSettingsSection('scheduler')">Scheduler</button>
        <button class="rail-btn"        data-section="notifications" onclick="selectSettingsSection('notifications')">Notifications</button>
        <button class="rail-btn"        data-section="services"      onclick="selectSettingsSection('services')">Services</button>
        <button class="rail-btn"        data-section="advanced"      onclick="selectSettingsSection('advanced')">Advanced</button>
        <div class="settings-rail-version" title="App version (from package.json)">v${APP_VERSION}</div>
      </nav>
      <div class="settings-pane" id="settingsView">Loading…</div>
    </div>
    <div class="settings-footer" id="settingsFooter" style="display:none">
      <span class="dirty-count" id="dirtyCount">0 unsaved changes</span>
      <button class="btn btn-cancel" onclick="discardSettings()" id="btnDiscardSettings">Discard</button>
      <button class="btn btn-run" onclick="saveSettings()" id="btnSaveSettings">Save</button>
    </div>
  </div>
  <div class="tab-panel" data-panel="environment">
    <div class="env-view-head">
      <div>
        <h3 class="env-view-title">Environment</h3>
        <div class="env-view-sub">Read-only view of every environment variable the app reads. Use <b>Settings → Services</b> to change runtime behaviour. <b>Reveal credentials</b> shows each secret as <code>••••••XXXX</code> — last 4 chars only — so don't tap it on a shared screen.</div>
      </div>
      <button class="btn btn-check-all" id="btnRevealCreds" onclick="toggleRevealEnv()">Reveal credentials</button>
    </div>
    <div class="env-view-body" id="envView">Loading…</div>
  </div>
  <div class="tab-panel" data-panel="library" style="overflow-y:auto;padding:24px 32px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <input id="lib-q" type="text" placeholder="Search title..." style="flex:1;min-width:140px;padding:6px 10px;background:#16213e;border:1px solid #333;border-radius:6px;color:#e0e0e0">
      <select id="lib-platform" style="padding:6px 10px;background:#16213e;border:1px solid #333;border-radius:6px;color:#e0e0e0">
        <option value="">All platforms</option>
        <option value="epic-games">Epic Games</option>
        <option value="prime-gaming">Prime Gaming</option>
        <option value="gog">GOG</option>
        <option value="steam">Steam</option>
      </select>
      <select id="lib-status" style="padding:6px 10px;background:#16213e;border:1px solid #333;border-radius:6px;color:#e0e0e0">
        <option value="">All statuses</option>
        <option value="claimed">Claimed</option>
        <option value="existed">Already owned</option>
      </select>
      <button id="lib-export" style="padding:6px 12px;background:#2a2a4e;border:1px solid #444;border-radius:6px;color:#e0e0e0;cursor:pointer">Export CSV</button>
    </div>
    <div id="lib-count" style="color:#888;font-size:13px;margin-bottom:8px">Loading...</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:1px solid #333;color:#aaa;text-align:left">
        <th style="padding:6px 8px">Title</th><th style="padding:6px 8px">Platform</th>
        <th style="padding:6px 8px">Status</th><th style="padding:6px 8px">Date</th>
        <th style="padding:6px 8px">Link</th>
      </tr></thead>
      <tbody id="lib-tbody"></tbody>
    </table>
  </div>
  <div class="tab-panel" data-panel="accounts">
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
</div>
<script>
const NOVNC_PORT = ${NOVNC_PORT};
const BASE_PATH = '${BASE_PATH}';
let state = { sites: [], activeBrowser: null, allLoggedIn: false, runStatus: 'idle' };
let busy = false;
let showingLog = false;
// User-toggled noVNC view via the "Show browser" header button. Independent
// of activeBrowser/showingLog so the user can peek at the live browser
// during a claim run (which normally swaps the iframe for the run log).
let userShowBrowser = false;
let logOffset = 0;
let logPollTimer = null;
let pendingGogCount = 0;

// Drawer expand state lives in JS rather than the DOM because render() rebuilds
// availableDrawer.innerHTML on every poll — pre-this fix, clicking the caret
// flipped the DOM but the next render reset it from a stale localStorage flag,
// so the drawer "did nothing" for the user.
let drawerExpanded = localStorage.getItem('drawerSeen') !== '1';

function toggleAvailableDrawer() {
  drawerExpanded = !drawerExpanded;
  localStorage.setItem('drawerSeen', '1');
  render();
}

// User-controlled collapse for the entire sessions strip below the status
// line — hides session cards, the available-services drawer, batch redeem
// info, and the active-session row, leaving just the status strip visible
// as a one-line summary so the VNC iframe / run log gets full vertical
// space below. Persisted across reloads.
let sessionsCollapsed = localStorage.getItem('sessionsCollapsed') === '1';

function toggleSessionsCollapsed() {
  sessionsCollapsed = !sessionsCollapsed;
  localStorage.setItem('sessionsCollapsed', sessionsCollapsed ? '1' : '0');
  render();
}

async function enableService(id) {
  localStorage.setItem('drawerSeen', '1');
  // Honour service → underlying-sites linking (Microsoft desktop + mobile
  // share a setting). The inverse lookup: if the clicked card is one of a
  // linked group, enable all siblings too.
  const sites = new Set([id]);
  for (const [primary, linked] of Object.entries(LINKED_ACTIVE)) {
    if (linked.includes(id)) linked.forEach(x => sites.add(x));
    if (primary === id)       linked.forEach(x => sites.add(x));
  }
  const patch = {};
  for (const s of sites) patch['services.' + s + '.active'] = true;
  try {
    await api('PUT', '/config', patch);
    showToast('Enabled — checking session…', 'success');
    await refreshState();
    // Kick off a session probe for each freshly-enabled card so the status
    // dot flips from gray to red/green without waiting for the next tick.
    for (const s of sites) {
      api('POST', '/check', { site: s }).then(refreshState).catch(() => {});
    }
  } catch (e) {
    showToast('Failed to enable: ' + (e && e.message || 'unknown'), 'error');
  }
}

function switchTab(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tab-nav .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  if (tab === 'logs') startLogsTabPoll();
  else stopLogsTabPoll();
  if (tab === 'schedule') renderScheduleTab();
  if (tab === 'stats') renderStatsTab();
  if (tab === 'settings') renderSettingsTab();
  if (tab === 'environment') renderEnvironmentTab();
  if (tab === 'library') { if (!document.getElementById('lib-tbody').children.length) loadLibrary(); }
  if (tab === 'accounts') { loadAccounts(); }
}

async function renderEnvironmentTab() {
  // Environment is read-only; reuse the same loadEnvTable used to live
  // inside the Settings tab. No settings-config fetch needed.
  await loadEnvTable(envRevealed);
}

// --- Settings tab ---
// Holds the last /api/config response. Re-fetched on tab entry and after save.
let settingsData = null;
// path → proposed value. null means "revert this field to env/default".
let settingsDirty = {};

async function renderSettingsTab() {
  const view = document.getElementById('settingsView');
  if (!view) return;
  try {
    settingsData = await api('GET', '/config');
    settingsDirty = {};
    paintSettings();
  } catch (e) {
    view.innerHTML = '<div class="stats-empty" style="margin:24px">Failed to load config: ' + escapeHtml(e.message) + '</div>';
  }
}

// Which section the Settings rail currently has selected.
let currentSettingsSection = 'scheduler';
// Per-field help-popover + per-service accordion state. Kept across repaints.
const openHelp = new Set();
const openServices = new Set();

function selectSettingsSection(name) {
  currentSettingsSection = name;
  document.querySelectorAll('.settings-rail .rail-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.section === name);
  });
  paintSettings();
}

function toggleFieldHelp(path) {
  if (openHelp.has(path)) openHelp.delete(path); else openHelp.add(path);
  paintSettings();
}

// Formats a numeric field value into a human-readable conversion shown as
// an inline suffix next to the input ("60 [seconds] = 1m"). Returns '' when
// no useful conversion exists (e.g. zero/negative, or units that don't divide
// cleanly), so the suffix slot stays empty rather than showing "= 0m".
function unitSuffix(unit, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (unit === 'seconds') {
    if (n % 86400 === 0) return '= ' + (n / 86400) + 'd';
    if (n % 3600 === 0)  return '= ' + (n / 3600) + 'h';
    if (n % 60 === 0)    return '= ' + (n / 60) + 'm';
    return '';
  }
  if (unit === 'hours') {
    if (n % 24 === 0)    return '= ' + (n / 24) + 'd';
    return '';
  }
  if (unit === 'days') {
    if (n >= 7 && n % 7 === 0) return '= ' + (n / 7) + 'w';
    return '';
  }
  return '';
}

function toggleServiceBody(id) {
  if (openServices.has(id)) openServices.delete(id); else openServices.add(id);
  paintSettings();
}

// Returns the value the form should show for a path, considering in-flight
// draft edits. For pending reverts (draft === null) falls back to env/default.
function draftValue(path) {
  if (!settingsData) return null;
  const f = settingsData.fields.find(x => x.path === path);
  if (!f) return null;
  if (Object.prototype.hasOwnProperty.call(settingsDirty, path)) {
    const v = settingsDirty[path];
    if (v !== null) return v;
    if (f.envValue !== null && f.envValue !== undefined) {
      return f.type === 'number' ? Number(f.envValue)
           : f.type === 'boolean' ? (f.envValue === '1' || f.envValue === 'true')
           : f.envValue;
    }
    return f.default;
  }
  return f.effective;
}

function isOverriddenInForm(path) {
  if (!settingsData) return false;
  const f = settingsData.fields.find(x => x.path === path);
  if (!f) return false;
  if (Object.prototype.hasOwnProperty.call(settingsDirty, path)) {
    return settingsDirty[path] !== null; // revert-pending flips overridden off
  }
  return f.overridden;
}

function isServiceActiveForUI(id) {
  return !!draftValue('services.' + id + '.active');
}

// Wrap a set of fieldRow strings in a labeled group with a small-caps
// subheader. Used on Advanced + Notifications to break the page into
// logical clusters (Timeouts, Debug, Viewport, …) instead of one long list.
function settingGroup(title, body) {
  return '<div class="setting-group">' +
    '<div class="setting-group-head">' + escapeHtml(title) + '</div>' +
    body +
  '</div>';
}

// Build the HTML for one settings row. Help + env-var name live inside a
// popover opened by the ⓘ button; Revert only renders when the field is
// overridden relative to env/default.
function fieldRow(path, label, extra) {
  if (!settingsData) return '';
  const f = settingsData.fields.find(x => x.path === path);
  if (!f) return '';
  extra = extra || {};
  const value = draftValue(path);
  const overridden = isOverriddenInForm(path);
  const dot = overridden ? '<span class="setting-dot" title="Overrides environment"></span>' : '';
  const hasPopover = !!(extra.hint || f.envVar);
  const helpOpen = openHelp.has(path);
  const infoBtn = hasPopover
    ? '<button type="button" class="setting-info' + (helpOpen ? ' open' : '') + '" onclick="toggleFieldHelp(\\'' + path + '\\')" title="Help">i</button>'
    : '';
  const popoverBody = (extra.hint ? escapeHtml(extra.hint) : '') +
    (f.envVar ? '<span class="env-tag">Env: ' + escapeHtml(f.envVar) + '</span>' : '');
  const popover = (hasPopover && helpOpen)
    ? '<div class="setting-help-popover open">' + popoverBody + '</div>'
    : '';

  const revertBtn = overridden
    ? '<button type="button" class="setting-revert" onclick="revertSettingValue(\\'' + path + '\\')">Revert</button>'
    : '';

  // Glue the (i) icon (and overridden-dot) to the last word of the label so
  // they wrap together rather than orphaning onto a new line below the text.
  const labelStr = String(label);
  const lastSpace = labelStr.lastIndexOf(' ');
  const labelHead = lastSpace > 0 ? labelStr.slice(0, lastSpace + 1) : '';
  const labelTail = lastSpace > 0 ? labelStr.slice(lastSpace + 1) : labelStr;
  const labelHtml = escapeHtml(labelHead) +
    '<span class="setting-label-tail">' + escapeHtml(labelTail) + dot + infoBtn + '</span>';

  // Variant C — booleans render as one inline cluster (checkbox-left + label),
  // not the label/input two-column grid. The (i) button lives inside <label>:
  // HTML5 suppresses label activation when clicking interactive descendants,
  // so the help popover opens without toggling the checkbox.
  if (f.type === 'boolean') {
    return '<div class="setting setting-bool" data-path="' + path + '">' +
      '<label class="setting-bool-cluster">' +
        '<input type="checkbox" ' + (value ? 'checked' : '') + ' onchange="setSettingValue(\\'' + path + '\\', this.checked)">' +
        '<span>' + escapeHtml(labelHead) + '<span class="setting-label-tail">' + escapeHtml(labelTail) + dot + infoBtn + '</span></span>' +
      '</label>' +
      revertBtn +
      popover +
    '</div>';
  }

  let inputHtml;
  if (extra.options) {
    const options = extra.options.map(o => '<option value="' + o.value + '"' + (String(value) === String(o.value) ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>').join('');
    const cast = f.type === 'number' ? 'Number(this.value)' : 'this.value';
    inputHtml = '<select onchange="setSettingValue(\\'' + path + '\\', ' + cast + ')">' + options + '</select>';
  } else if (f.type === 'number') {
    const v = value == null ? '' : value;
    const suffixText = extra.unit ? unitSuffix(extra.unit, value) : '';
    const suffix = suffixText ? '<span class="input-suffix">' + escapeHtml(suffixText) + '</span>' : '';
    const inputEl = '<input type="number" value="' + v + '" oninput="setSettingValue(\\'' + path + '\\', this.value === \\'\\' ? null : Number(this.value))">';
    const inputCore = extra.prefix
      ? '<span class="input-with-prefix"><span class="input-prefix">' + escapeHtml(extra.prefix) + '</span>' + inputEl + '</span>'
      : inputEl;
    inputHtml = inputCore + suffix;
  } else if (extra.multiline) {
    inputHtml = '<textarea oninput="setSettingValue(\\'' + path + '\\', this.value)">' + escapeHtml(value || '') + '</textarea>';
  } else {
    inputHtml = '<input type="text" value="' + escapeHtml(value || '') + '" oninput="setSettingValue(\\'' + path + '\\', this.value)">';
  }

  return '<div class="setting" data-path="' + path + '">' +
    '<div class="setting-label">' + labelHtml + '</div>' +
    '<div class="setting-input">' + inputHtml + '</div>' +
    revertBtn +
    popover +
  '</div>';
}

// Per-service summary string shown when the accordion row is collapsed.
function serviceSummary(id) {
  if (!isServiceActiveForUI(id)) return 'Enable to configure.';
  const v = k => draftValue('services.' + id + '.' + k);
  switch (id) {
    case 'prime-gaming': {
      const t = v('timeLeftDays');
      return 'Redeem ' + (v('redeem') ? 'on' : 'off') +
        ' · DLC ' + (v('claimDlc') ? 'on' : 'off') +
        ' · Timeleft ' + (t == null ? 'none' : t + ' days');
    }
    case 'epic-games':
      return 'Mobile ' + (v('claimMobile') ? 'on' : 'off');
    case 'gog':
      return 'Newsletter ' + (v('keepNewsletter') ? 'keep' : 'unsubscribe');
    case 'steam':
      return 'Min rating ' + v('minRating') + ' · Min price $' + v('minPrice');
    case 'microsoft': {
      const w = draftValue('scheduler.msScheduleHours') || 0;
      const s = draftValue('scheduler.msScheduleStart') || 0;
      if (!w) return 'Runs immediately · desktop + mobile sessions';
      const fmt = h => String(h).padStart(2, '0') + ':00';
      return 'Window ' + fmt(s) + ' → ' + fmt((Number(s) + Number(w)) % 24) + ' · desktop + mobile';
    }
    case 'aliexpress':
      return 'Daily check-in coins · mobile site';
    default:
      return '';
  }
}

// Services whose Active toggle controls more than one underlying site.
// Microsoft desktop + mobile share everything — settings, credentials, claim
// script (microsoft.js runs both sessions internally). We present them as a
// single service in the Settings UI but keep two session cards in the
// Sessions tab for per-session login-state visibility.
const LINKED_ACTIVE = {
  'microsoft': ['microsoft', 'microsoft-mobile'],
};

// Hours dropdown reused by multiple fields.
const HOURS_OF_DAY = (() => {
  const out = [];
  for (let h = 0; h < 24; h++) out.push({ value: h, label: String(h).padStart(2, '0') + ':00' });
  return out;
})();

// Settings-tab fields grouped per service so the accordion code can iterate.
const SERVICE_ROWS = [
  { id: 'prime-gaming', title: 'Prime Gaming', fields: [
    ['services.prime-gaming.redeem',       'Redeem keys on external stores'],
    ['services.prime-gaming.claimDlc',     'Claim in-game DLC content',
      { hint: 'Amazon removed the in-game content tab from Prime Gaming — this toggle is currently a no-op. The script skips cleanly when the tab is missing; will resume claiming if/when Amazon brings it back.' }],
    ['services.prime-gaming.timeLeftDays', 'Skip if more than N days remain to claim',
      { unit: 'days', hint: 'Leave blank to claim everything regardless of how long is left.' }],
  ]},
  { id: 'epic-games', title: 'Epic Games', fields: [
    ['services.epic-games.claimMobile', 'Claim mobile games'],
  ]},
  { id: 'gog', title: 'GOG', fields: [
    ['services.gog.keepNewsletter', 'Keep newsletter subscription after claiming'],
  ]},
  { id: 'steam', title: 'Steam', fields: [
    ['services.steam.minRating', 'Minimum review rating (1–9)',
      { hint: '6 = Mostly Positive; 7 = Very Positive; 8 = Overwhelmingly Positive.' }],
    ['services.steam.minPrice', 'Minimum original price', { prefix: '$',
      hint: 'Filters out shovelware that was free or near-free before the giveaway.' }],
  ]},
  // Microsoft Rewards: one row controls both desktop and mobile sessions.
  // MS_SCHEDULE_* fields moved here from the Scheduler section because they
  // only affect the Microsoft Rewards run, not the global loop.
  { id: 'microsoft', title: 'Microsoft Rewards', subtitle: 'Runs both desktop and mobile sessions in one script.', fields: [
    ['scheduler.msScheduleHours', 'Schedule window width (hours)',
      { unit: 'hours', hint: 'Width of the daily Microsoft Rewards window, anchored to the start time. 0 runs immediately without anchoring.' }],
    ['scheduler.msScheduleStart', 'Schedule window start (local time)',
      { options: HOURS_OF_DAY }],
    ['services.microsoft.searchDelayMaxSec', 'Max delay between Bing searches (seconds)',
      { unit: 'seconds', hint: 'Upper bound for the random pause before each Bing search. Default 180 mimics a human pace; lower values shorten runs significantly (~60 searches × this/2 avg = total search time) but increase the risk of MS flagging the account as a bot.' }],
  ]},
  { id: 'aliexpress', title: 'AliExpress', fields: [] },
  { id: 'ubisoft', title: 'Ubisoft Connect', subtitle: 'Watch-only: pings you when a new free game appears at store.ubisoft.com/us/free-games. No login, no auto-claim — go grab it manually.', fields: [] },
];

function serviceRow(entry) {
  const active = isServiceActiveForUI(entry.id);
  const hasFields = entry.fields.length > 0;
  const open = active && openServices.has(entry.id) && hasFields;
  const caret = open ? '▾' : '▸';
  const subtitleHtml = (open && entry.subtitle)
    ? '<div class="svc-subtitle">' + escapeHtml(entry.subtitle) + '</div>'
    : '';
  const body = open
    ? '<div class="svc-body open">' + subtitleHtml + entry.fields.map(f => fieldRow(f[0], f[1], f[2])).join('') + '</div>'
    : '';
  const expandable = active && hasFields;
  const onclick = expandable ? 'onclick="toggleServiceBody(\\'' + entry.id + '\\')"' : '';
  const countLabel = hasFields
    ? '<span class="svc-count">' + entry.fields.length + ' setting' + (entry.fields.length === 1 ? '' : 's') + ' ' + (open ? '▾' : '▸') + '</span>'
    : '';
  return '<div class="svc-row' + (active ? '' : ' inactive') + (expandable ? ' expandable' : '') + '">' +
    '<div class="svc-head">' +
      '<label class="svc-toggle" title="' + (active ? 'Active' : 'Inactive') + '" aria-label="' + (active ? 'Disable' : 'Enable') + ' ' + escapeHtml(entry.title) + '">' +
        '<input type="checkbox" ' + (active ? 'checked' : '') +
          ' onchange="setActiveService(\\'' + entry.id + '\\', this.checked)">' +
        '<span class="svc-toggle-track"><span class="svc-toggle-thumb"></span></span>' +
      '</label>' +
      '<button type="button" class="svc-expand" ' + onclick + (expandable ? '' : ' disabled') + '>' +
        '<span class="svc-caret' + (expandable ? '' : ' svc-caret-disabled') + '">' + caret + '</span>' +
        '<span class="svc-name-line">' +
          '<span class="svc-name">' + escapeHtml(entry.title) + '</span>' +
          (expandable ? countLabel : '') +
        '</span>' +
        '<span class="svc-summary">' + escapeHtml(serviceSummary(entry.id)) + '</span>' +
      '</button>' +
    '</div>' +
    body +
  '</div>';
}

function paintSettings() {
  const view = document.getElementById('settingsView');
  if (!view || !settingsData) return;

  let html = '';
  if (currentSettingsSection === 'scheduler') {
    html =
      '<div class="settings-pane-title">Scheduler</div>' +
      fieldRow('scheduler.loopSeconds', 'Loop interval (seconds)',
        { unit: 'seconds', hint: 'Time between scheduled runs. 0 disables the loop. Microsoft Rewards has its own window — set it under Services → Microsoft Rewards.' });
  } else if (currentSettingsSection === 'notifications') {
    html =
      '<div class="settings-pane-title">Notifications' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-check-all" onclick="testNotify()" id="btnTestNotify">Send test</button>' +
      '</div>' +
      settingGroup('Destinations',
        fieldRow('notifications.notify', 'Apprise URL(s)',
          { multiline: true, hint: 'One URL per line (or comma-separated). Examples: pover://token@user, tgram://botid/chatid.' }) +
        fieldRow('notifications.notifyTitle', 'Title prefix') +
        fieldRow('notifications.attachScreenshots', 'Attach screenshot to failures',
          { hint: 'When a claim fails, attach the most recent .png from data/screenshots/ to the notification. Off if you prefer to keep notifications text-only (privacy or bandwidth).' })
      ) +
      settingGroup('Panel link',
        fieldRow('panel.publicUrl', 'Public URL',
          { hint: 'External URL used in notifications so tap-targets land on the panel.' })
      );
  } else if (currentSettingsSection === 'services') {
    html = '<div class="settings-pane-title">Services</div>' +
      '<div class="svc-list">' +
        SERVICE_ROWS.map(serviceRow).join('') +
      '</div>';
  } else if (currentSettingsSection === 'advanced') {
    // Order reflects what someone opening Advanced is usually there for:
    // first timeouts (most common debug tweak), then dry-run / recording,
    // then viewport.
    html =
      '<div class="settings-pane-title">Advanced</div>' +
      settingGroup('Timeouts',
        fieldRow('advanced.timeoutSec',      'Default timeout (seconds)', { unit: 'seconds', hint: 'Applies to Playwright page operations.' }) +
        fieldRow('advanced.loginTimeoutSec', 'Login timeout (seconds)',   { unit: 'seconds', hint: 'Separate timeout used during the login flow.' })
      ) +
      settingGroup('Debug',
        fieldRow('advanced.dryrun', 'Dry run — skip actual claiming',     { hint: 'Runs the claim pipeline without actually claiming anything. Useful for testing.' }) +
        fieldRow('advanced.record', 'Record HAR + video for debugging',   { hint: 'Writes per-run .webm + .har to data/record/. Heavier runs.' })
      ) +
      settingGroup('Viewport',
        fieldRow('advanced.width',  'Browser viewport width') +
        fieldRow('advanced.height', 'Browser viewport height')
      );
  }

  view.innerHTML = html;
  updateSettingsFooter();
}

// Environment (read-only) table. Credentials are hidden by default and need
// an explicit reveal click, which shows only the last 4 chars.
let envRevealed = false;
async function loadEnvTable(reveal) {
  const mount = document.getElementById('envView');
  if (!mount) return;
  try {
    const r = await api('GET', '/env' + (reveal ? '?reveal=1' : ''));
    const entries = (r && r.env) || [];
    // Group by category, preserving declaration order within each category.
    const catOrder = [];
    const byCat = {};
    for (const e of entries) {
      if (!byCat[e.category]) { byCat[e.category] = []; catOrder.push(e.category); }
      byCat[e.category].push(e);
    }
    const catLabel = { panel: 'Panel infrastructure', paths: 'Data paths', credentials: 'Credentials', debug: 'Debug / runtime' };
    const rows = [];
    for (const cat of catOrder) {
      rows.push('<tr class="cat-row"><td colspan="3">' + escapeHtml(catLabel[cat] || cat) + '</td></tr>');
      let lastGroup = null;
      for (const e of byCat[cat]) {
        if (e.group && e.group !== lastGroup) {
          rows.push('<tr class="group-row"><td colspan="3">' + escapeHtml(e.group) + '</td></tr>');
          lastGroup = e.group;
        }
        const name = '<span class="env-name">' + escapeHtml(e.env) + '</span>';
        let valueCell;
        if (!e.set) {
          valueCell = '<span class="env-unset">unset</span>';
        } else if (e.sensitive && !reveal) {
          valueCell = '<span class="env-set-badge">set (hidden)</span>';
        } else if (e.sensitive && reveal) {
          valueCell = '<span class="env-masked">' + escapeHtml(e.value || '') + '</span>';
        } else {
          valueCell = '<span class="env-value">' + escapeHtml(e.value || '') + '</span>';
        }
        const labelCell = escapeHtml(e.label) +
          (e.note ? '<div class="env-note">' + escapeHtml(e.note) + '</div>' : '');
        const rowClass = 'data-row' + (e.group ? ' grouped' : '');
        rows.push('<tr class="' + rowClass + '"><td>' + name + '</td><td>' + labelCell + '</td><td>' + valueCell + '</td></tr>');
      }
    }
    mount.innerHTML = '<table class="env-table">' +
      '<thead><tr><th>Variable</th><th>Purpose</th><th>Value</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
    '</table>';
  } catch (e) {
    mount.innerHTML = '<div class="stats-empty">Failed to load env: ' + escapeHtml(e.message) + '</div>';
  }
}

async function toggleRevealEnv() {
  // Previously wrapped in confirm() — iPad Safari sometimes silently blocks
  // modal confirm() dialogs fired from click handlers (especially after any
  // browser restart), so the reveal appeared to "not work". The warning now
  // lives inline in the Environment header sub-text; tapping the button
  // flips state directly.
  const btn = document.getElementById('btnRevealCreds');
  envRevealed = !envRevealed;
  if (btn) btn.textContent = envRevealed ? 'Hide credentials' : 'Reveal credentials';
  await loadEnvTable(envRevealed);
}

function setSettingValue(path, value) {
  const f = settingsData.fields.find(x => x.path === path);
  if (!f) return;
  // If the draft matches what's already effective AND there's no existing
  // app override, treat as "no change" and drop the dirty entry.
  if (!f.overridden && value !== null && String(value) === String(f.effective)) {
    delete settingsDirty[path];
  } else {
    settingsDirty[path] = value;
  }
  updateSettingsFooter();
  // Repaint whenever a service's Active flag flips so sub-flags appear or
  // disappear (progressive disclosure). Skip for other paths so text inputs
  // don't lose focus mid-typing.
  if (/^services\\.[^.]+\\.active$/.test(path)) paintSettings();
}

async function setActiveService(id, nextActive) {
  const sites = LINKED_ACTIVE[id] || [id];
  if (!nextActive) {
    // Confirm deactivation only when ANY linked site has history to lose.
    let hasHistory = false;
    try {
      const byService = await api('GET', '/stats/by-service');
      hasHistory = sites.some(sid => {
        const row = byService.find(r => r.id === sid);
        return row && ((typeof row.allTime === 'number' && row.allTime > 0) || row.lastClaimAt);
      });
    } catch {}
    if (hasHistory) {
      const label = ({
        'prime-gaming': 'Prime Gaming', 'epic-games': 'Epic Games', 'gog': 'GOG', 'steam': 'Steam',
        'microsoft': 'Microsoft Rewards', 'aliexpress': 'AliExpress',
      })[id] || id;
      const ok = confirm('Deactivate ' + label + '?\\n\\nClaim history already on record will be preserved, but scheduled runs will skip this service until you reactivate it.');
      if (!ok) { paintSettings(); return; }
    }
  }
  for (const siteId of sites) setSettingValue('services.' + siteId + '.active', nextActive);
  paintSettings();
}

function revertSettingValue(path) {
  const f = settingsData.fields.find(x => x.path === path);
  if (!f) return;
  if (f.overridden) {
    // Remove the on-disk override — queue a null patch.
    settingsDirty[path] = null;
  } else {
    // Just drop any in-flight edit.
    delete settingsDirty[path];
  }
  paintSettings();
}

function updateSettingsFooter() {
  const footer = document.getElementById('settingsFooter');
  const counter = document.getElementById('dirtyCount');
  if (!footer || !counter) return;
  const n = Object.keys(settingsDirty).length;
  if (n === 0) {
    footer.style.display = 'none'; // idle → footer disappears entirely
    return;
  }
  footer.style.display = 'flex';
  counter.textContent = n + ' unsaved change' + (n === 1 ? '' : 's');
}

function discardSettings() {
  settingsDirty = {};
  paintSettings();
}

async function saveSettings() {
  const btn = document.getElementById('btnSaveSettings');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const res = await api('PUT', '/config', settingsDirty);
    if (res && res.errors) {
      showToast('Some changes failed: ' + res.errors.map(e => e.path + ' (' + e.error + ')').join('; '), 'error', 6000);
      return;
    }
    settingsData = res;
    settingsDirty = {};
    paintSettings();
    showToast('Settings saved. Scheduler changes apply after a restart.', 'success');
  } catch (e) {
    showToast('Save failed: ' + (e && e.message || 'unknown error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function testNotify() {
  const btn = document.getElementById('btnTestNotify');
  if (!btn) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await api('POST', '/notifications/test');
    if (res && res.ok) showToast('Test notification sent', 'success');
    else showToast('Test failed: ' + (res && res.error || 'unknown error'), 'error', 6000);
  } catch (e) {
    showToast('Test failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function relativeTime(dtStr) {
  if (!dtStr) return '';
  const d = new Date(String(dtStr).replace(' ', 'T'));
  if (!Number.isFinite(d.getTime())) return dtStr;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  if (mins < 1) return 'just now';
  const prefix = diff < 0 ? 'in ' : '';
  const suffix = diff < 0 ? ''   : ' ago';
  if (mins < 60) {
    if (prefix && mins >= 2) {
      // "in 1h 15m" reads better than "in 75m" — combine hours + minutes for near-future.
      return prefix + mins + 'm' + suffix;
    }
    return prefix + mins + 'm' + suffix;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    if (prefix) {
      const rem = mins - hrs * 60;
      return prefix + hrs + 'h' + (rem ? ' ' + rem + 'm' : '') + suffix;
    }
    return hrs + 'h ago';
  }
  const days = Math.floor(hrs / 24);
  if (days < 30) return prefix + days + 'd' + suffix;
  const months = Math.floor(days / 30);
  if (months < 12) return prefix + months + 'mo' + suffix;
  return prefix + Math.floor(months / 12) + 'y' + suffix;
}

// Unified timestamp formatter.
//   style 'relative' → "2d ago" (via relativeTime)
//   style 'short'    → "YYYY-MM-DD HH:MM" (trims seconds + milliseconds)
// Uses slice(0, 16) rather than a \d regex — PANEL_HTML is itself a backtick
// template literal, and "\d" inside it is treated as an unknown escape and
// stripped, producing /^(d{4}-...)/ which never matches.
function formatTimestamp(ts, style) {
  if (!ts) return '';
  if (style === 'relative') return relativeTime(ts);
  return String(ts).replace('T', ' ').slice(0, 16);
}

// HTML+CSS 30-day bar chart. An earlier SVG version used
// preserveAspectRatio="none" to stretch bars to fill the container width,
// which also stretched the axis text glyphs horizontally — the bug the user
// reported as "font stretching". Pure HTML sidesteps that entirely: bars flex
// to fit, labels render at natural font metrics.
function renderDailyChart(daily) {
  if (!daily.length) return '<div class="stats-empty">No data yet.</div>';
  const rawMax = Math.max.apply(null, daily.map(d => d.count).concat(0));
  const step = rawMax <= 4 ? 1 : rawMax <= 10 ? 2 : rawMax <= 20 ? 5 : rawMax <= 50 ? 10 : 20;
  const yMax = Math.max(step, Math.ceil(rawMax / step) * step);
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push('<span>' + v + '</span>');
  // Native tooltip uses &#10; for line breaks so each "Service: Title" lands on
  // its own row. Each line is escaped first; the entity is appended after so
  // it survives as a real newline when the browser parses the title attribute.
  const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bars = daily.map(d => {
    const pct = (d.count / yMax) * 100;
    const cls = d.count === 0 ? ' zero' : '';
    const lines = [d.date + ': ' + d.count].concat(
      (d.items || []).map(it => (it.serviceName || it.service) + ': ' + it.title)
    );
    const tip = lines.map(escAttr).join('&#10;');
    return '<div class="bar' + cls + '" style="height:' + pct + '%" title="' + tip + '"></div>';
  }).join('');
  // Weekly ticks anchored at today's right edge. Empty xtick slots keep each
  // bar column aligned with its flex cell (preserving 1:1 bar<->label mapping).
  const labelIdx = new Set();
  for (let i = daily.length - 1; i >= 0; i -= 7) labelIdx.add(i);
  const xLabels = daily.map((_, i) => {
    const md = labelIdx.has(i) ? daily[i].date.slice(5) : '';
    return '<span class="xtick">' + md + '</span>';
  }).join('');
  return '<div class="chart-plot">' +
    '<div class="chart-y-axis">' + yTicks.join('') + '</div>' +
    '<div class="chart-area">' +
      '<div class="chart-bars">' + bars + '</div>' +
      '<div class="chart-x-axis">' + xLabels + '</div>' +
    '</div>' +
  '</div>';
}

async function renderStatsTab() {
  const kpis = document.getElementById('statsKpis');
  const table = document.getElementById('statsTable');
  const chartArea = document.getElementById('chartArea');
  const chartSectionTitle = document.getElementById('chartSectionTitle');
  const activity = document.getElementById('statsActivity');
  if (!kpis) return;
  try {
    const [summary, byService, daily, recent] = await Promise.all([
      api('GET', '/stats/summary'),
      api('GET', '/stats/by-service'),
      api('GET', '/stats/daily?days=30'),
      api('GET', '/activity?limit=10'),
    ]);
    const fmt = n => (n == null ? '—' : new Intl.NumberFormat().format(n));
    const msPending = summary.msPointsBalance == null;
    const tiles = [
      { label: 'Games this week',  value: fmt(summary.gamesThisWeek) },
      { label: 'Games this month', value: fmt(summary.gamesThisMonth) },
      { label: 'Games all-time',   value: fmt(summary.gamesAllTime) },
      { label: 'Last claim',
        value: summary.lastClaim ? formatTimestamp(summary.lastClaim.at, 'relative') : '—',
        hint:  summary.lastClaim ? summary.lastClaim.serviceName + ' · ' + summary.lastClaim.title : '' },
      { label: 'MS Rewards balance',
        value: msPending ? 'Pending' : fmt(summary.msPointsBalance),
        hint:  msPending ? 'captured on next microsoft run' : 'as of ' + formatTimestamp(summary.msPointsBalanceAt, 'short') },
      { label: 'MS points this week',
        value: msPending ? 'Pending' : fmt(summary.msPointsThisWeek),
        hint:  msPending ? 'captured on next microsoft run' : 'via captured runs' },
    ];
    kpis.innerHTML = tiles.map(k =>
      '<div class="kpi"><div class="kpi-label">' + k.label + '</div>' +
      '<div class="kpi-value">' + escapeHtml(String(k.value)) + '</div>' +
      (k.hint ? '<div class="kpi-hint">' + escapeHtml(k.hint) + '</div>' : '') +
      '</div>'
    ).join('');

    const fmt2 = n => new Intl.NumberFormat().format(n);
    const unitSuffix = u => u === 'points' ? ' pts' : u === 'coins' ? ' coins' : '';
    const unitPlaceholder = u => u === 'points'
      ? 'points-based — balance appears after the next microsoft run'
      : u === 'coins'
        ? 'coins-based — appears after enabling AliExpress and running once'
        : u + '-based';
    const rows = byService.map(r => {
      const last = r.lastClaimAt
        ? '<span title="' + escapeHtml(r.lastClaimAt) + '">' + escapeHtml(formatTimestamp(r.lastClaimAt, 'relative')) + '</span>'
        : '<span class="muted">—</span>';
      const unit = r.unit || 'games';
      const isGame = unit === 'games';
      if (!isGame && !r.lastClaimAt) {
        return '<tr><td>' + escapeHtml(r.name) + '</td>' +
          '<td colspan="4" class="muted note">' + unitPlaceholder(unit) + '</td></tr>';
      }
      const suffix = unitSuffix(unit);
      return '<tr><td>' + escapeHtml(r.name) + '</td>' +
        '<td class="num">' + fmt2(r.thisWeek) + suffix + '</td>' +
        '<td class="num">' + fmt2(r.thisMonth) + suffix + '</td>' +
        '<td class="num">' + fmt2(r.allTime) + suffix + '</td>' +
        '<td class="ts">' + last + '</td></tr>';
    }).join('');
    table.innerHTML = '<thead><tr>' +
      '<th>Service</th>' +
      '<th class="num">This week</th>' +
      '<th class="num">This month</th>' +
      '<th class="num">All-time</th>' +
      '<th class="ts">Last claim</th>' +
      '</tr></thead><tbody>' + rows + '</tbody>';

    const totalInRange = daily.reduce((s, d) => s + d.count, 0);
    chartSectionTitle.textContent = 'Claims over the last 30 days · ' + totalInRange + ' total';
    chartArea.innerHTML = renderDailyChart(daily);

    if (!recent || !recent.length) {
      activity.innerHTML = '<div class="stats-empty">No claims recorded yet. The activity log will populate after your first successful claim run.</div>';
    } else {
      activity.innerHTML = recent.map(a => {
        const titleHtml = a.url
          ? '<a href="' + encodeURI(a.url) + '" target="_blank" rel="noopener">' + escapeHtml(a.title) + '</a>'
          : escapeHtml(a.title);
        return '<div class="act">' +
          '<span class="at" title="' + escapeHtml(a.at) + '">' + escapeHtml(formatTimestamp(a.at, 'relative')) + '</span>' +
          '<span class="svc">' + escapeHtml(a.serviceName) + '</span>' +
          '<span class="title">' + titleHtml + '</span>' +
          '</div>';
      }).join('');
    }
  } catch (e) {
    kpis.innerHTML = '<div style="color:#e94560;padding:20px;background:#2a1a1e;border-radius:6px">Failed to load stats: ' + escapeHtml((e && e.message) || 'unknown error') + '</div>';
  }
}

function renderScheduleTab() {
  const view = document.getElementById('schedView');
  if (!view) return;
  const parts = [];
  if (state.nextScheduledRun) {
    parts.push(
      '<div class="sched-row">' +
        '<div class="sched-label">Next run</div>' +
        '<div><span class="sched-value big" title="' + state.nextScheduledRun + '">' + formatTimestamp(state.nextScheduledRun, 'short') + '</span>' +
        '<span class="sched-count" id="schedCountdown"></span></div>' +
      '</div>'
    );
  } else {
    const txt = state.loopEnabled ? 'Calculating…' : 'Scheduler disabled';
    parts.push('<div class="sched-row"><div class="sched-label">Next run</div><div class="sched-value muted">' + txt + '</div></div>');
  }
  // Interval row: pure LOOP description. MS-window info moved into the
  // Services row below so the two schedules show side-by-side.
  let intervalText;
  if (state.loopSeconds > 0) {
    const hrs = state.loopSeconds / 3600;
    if (hrs >= 1 && Number.isInteger(hrs)) intervalText = 'Every ' + hrs + ' hour' + (hrs === 1 ? '' : 's');
    else if (state.loopSeconds >= 60) intervalText = 'Every ' + Math.round(state.loopSeconds / 60) + ' minutes';
    else intervalText = 'Every ' + state.loopSeconds + ' seconds';
  } else if (state.msScheduleHours > 0) {
    intervalText = 'Anchored to Microsoft Rewards window (see Services below)';
  } else {
    intervalText = 'Not scheduled — set LOOP or enable Microsoft Rewards';
  }
  parts.push('<div class="sched-row"><div class="sched-label">Interval</div><div class="sched-value">' + intervalText + '</div></div>');

  // Services row: enumerate each active service and the behaviour it'll
  // exhibit on the next scheduled fire. Inactive services don't appear —
  // users deactivate to have them stop, so the schedule reflects reality.
  // microsoft-mobile is linked to microsoft in the UI, so we skip it here.
  const GAME_IDS = new Set(['prime-gaming', 'epic-games', 'gog', 'steam']);
  const sites = state.sites || [];
  const activeGames = sites.filter(s => s.active && GAME_IDS.has(s.id));
  const hasAE = sites.some(s => s.active && s.id === 'aliexpress');
  const hasMS = sites.some(s => s.active && s.id === 'microsoft');
  const activeCount = activeGames.length + (hasAE ? 1 : 0) + (hasMS ? 1 : 0);

  const svcLines = [];
  if (activeGames.length) {
    svcLines.push('<b>' + activeGames.map(s => escapeHtml(s.name)).join(', ') + '</b> — claim any available games');
  }
  if (hasAE) {
    svcLines.push('<b>AliExpress</b> — collect daily check-in coins <span class="muted">(no specific window; runs on each scheduled fire)</span>');
  }
  if (hasMS) {
    const w = state.msScheduleHours || 0;
    const s = state.msScheduleStart || 0;
    if (w > 0) {
      const fmt = h => String(h).padStart(2, '0') + ':00';
      svcLines.push('<b>Microsoft Rewards</b> — waits for <b>' + fmt(s) + ' → ' + fmt((Number(s) + Number(w)) % 24) + '</b> window each run, then searches');
    } else {
      svcLines.push('<b>Microsoft Rewards</b> — runs searches immediately (no window)');
    }
  }
  if (svcLines.length) {
    parts.push('<div class="sched-row"><div class="sched-label">Services (' + activeCount + ' active)</div>' +
      '<ul class="sched-services">' + svcLines.map(l => '<li>' + l + '</li>').join('') + '</ul></div>');
  } else {
    parts.push('<div class="sched-row"><div class="sched-label">Services</div><div class="sched-value muted">None active — enable services in Settings → Services.</div></div>');
  }

  if (state.lastRun) {
    const dur = state.lastRun.durationSec != null ? Math.round(state.lastRun.durationSec / 60) + 'm' : '';
    const statusCol = state.lastRun.status === 'success' ? '#4ecca3' : state.lastRun.status === 'error' ? '#e94560' : '#f0c040';
    parts.push(
      '<div class="sched-row"><div class="sched-label">Last run</div>' +
      '<div class="sched-value"><span title="' + state.lastRun.at + '">' + formatTimestamp(state.lastRun.at, 'short') + '</span>' +
        ' (' + state.lastRun.source + ') — ' +
        '<span style="color:' + statusCol + '">' + state.lastRun.status + '</span>' +
        (dur ? ' · ' + dur : '') +
      '</div></div>'
    );
  } else {
    parts.push('<div class="sched-row"><div class="sched-label">Last run</div><div class="sched-value muted">None yet</div></div>');
  }
  parts.push('<div class="sched-note">Pause/resume toggle and per-run history are on the way. Trigger an immediate claim from the Sessions tab via <b>Run Now</b>.</div>');
  view.innerHTML = parts.join('');
  updateScheduleCountdown();
}

function updateScheduleCountdown() {
  const el = document.getElementById('schedCountdown');
  if (!el || !state.nextScheduledRun) return;
  const target = new Date(state.nextScheduledRun.replace(' ', 'T')).getTime();
  if (!Number.isFinite(target)) return;
  const delta = target - Date.now();
  if (delta <= 0) { el.textContent = ' · due now'; return; }
  const mins = Math.floor(delta / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  let txt;
  if (days > 0) txt = 'in ' + days + 'd ' + (hrs % 24) + 'h';
  else if (hrs > 0) txt = 'in ' + hrs + 'h ' + (mins % 60) + 'm';
  else txt = 'in ' + Math.max(mins, 1) + 'm';
  el.textContent = ' · ' + txt;
}
setInterval(updateScheduleCountdown, 30000);

let logsTabOffset = 0;
let logsTabPollTimer = null;
function startLogsTabPoll() {
  if (logsTabPollTimer) return;
  logsTabOffset = 0;
  const body = document.getElementById('logsBody');
  if (body) body.innerHTML = '<div class="logs-empty">Loading…</div>';
  pollLogsTab();
}
function stopLogsTabPoll() {
  if (logsTabPollTimer) { clearTimeout(logsTabPollTimer); logsTabPollTimer = null; }
}
async function pollLogsTab() {
  if (document.body.dataset.tab !== 'logs') { stopLogsTabPoll(); return; }
  let interval = 3000;
  try {
    const r = await api('GET', '/run-log?since=' + logsTabOffset);
    const body = document.getElementById('logsBody');
    const count = document.getElementById('logsCount');
    if (body && r.lines && r.lines.length) {
      if (logsTabOffset === 0) body.innerHTML = '';
      r.lines.forEach(l => {
        const div = document.createElement('div');
        div.className = 'line ' + l.type;
        const t = (l.time && String(l.time).slice(11, 19)) || '';
        div.innerHTML = '<span class="time">' + t + '</span>' + escapeHtml(l.text);
        body.appendChild(div);
      });
      body.scrollTop = body.scrollHeight;
    } else if (body && logsTabOffset === 0 && (!r.lines || !r.lines.length)) {
      body.innerHTML = '<div class="logs-empty">No run activity yet. The log will populate during a manual Run Now or scheduled run.</div>';
    }
    if (typeof r.total === 'number') logsTabOffset = r.total;
    if (count) count.textContent = logsTabOffset + ' line' + (logsTabOffset === 1 ? '' : 's');
    if (r && r.status === 'running') interval = 1000;
  } catch {}
  logsTabPollTimer = setTimeout(pollLogsTab, interval);
}

async function refreshPendingGogCount() {
  try {
    const r = await api('GET', '/pending-gog-count');
    pendingGogCount = r.count || 0;
  } catch { pendingGogCount = 0; }
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_PATH + '/api' + path, opts);
  return res.json();
}

function showToast(message, type = 'info', duration = 4000) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function getStep() {
  const anyChecked = state.sites.some(s => s.status !== 'unknown');
  if (!anyChecked) return 1;
  if (!state.allLoggedIn) return 2;
  if (state.runStatus === 'running') return 3;
  if (state.lastRun) return 4;
  // Logged in, no run yet. If scheduler is enabled the scheduler will handle
  // it — return 'waiting' so the step shows subtle yellow instead of active
  // red (which would imply the user needs to act).
  return state.loopEnabled ? 'waiting' : 3;
}

function render() {
  const cards = document.getElementById('siteCards');
  const session = document.getElementById('activeSession');
  const strip = document.getElementById('statusStrip');
  const steps = document.getElementById('steps');
  const batchInfo = document.getElementById('batchRedeemInfo');
  const btnRunAll = document.getElementById('btnRunAll');
  const btnCheckAll = document.getElementById('btnCheckAll');
  const currentStep = getStep();

  if (document.body.dataset.tab === 'schedule') renderScheduleTab();

  // Batch-redeem panel: shows when there are pending GOG codes OR a batch is active.
  const br = state.batchRedeem;
  if (br) {
    batchInfo.style.display = 'block';
    const s = br.stats || {};
    const progressBar = '<span style="color:#888">' + br.index + ' / ' + br.total + ' codes</span>';
    const statsLine = [s.redeemed + ' redeemed', s.used + ' already', s.notFound + ' invalid', s.timeouts ? s.timeouts + ' timeouts' : null, s.errors ? s.errors + ' errors' : null].filter(Boolean).join(', ');
    const bgColor = br.phase === 'awaiting-captcha' ? '#3a1a1e' : br.phase === 'done' ? '#1a3a2e' : br.phase === 'stopped' || br.phase === 'error' ? '#3a2a1e' : '#0f3460';
    const borderColor = br.phase === 'awaiting-captcha' ? '#e94560' : br.phase === 'done' ? '#4ecca3' : '#555';
    let buttonsHtml = '';
    if (br.phase === 'running' || br.phase === 'awaiting-captcha') {
      buttonsHtml = '<button class="btn btn-stop" onclick="stopBatchRedeem()">Stop</button>';
    } else {
      buttonsHtml = '<button class="btn btn-cancel" onclick="clearBatchRedeem()">Dismiss</button>';
    }
    batchInfo.innerHTML =
      '<div style="background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '  <div style="flex:1;min-width:240px">' +
      '    <div style="font-weight:600;margin-bottom:2px">Batch redeem — ' + br.phase + '</div>' +
      '    <div style="font-size:13px;margin-bottom:4px">' + br.message + '</div>' +
      '    <div style="font-size:12px;color:#888">' + progressBar + ' · ' + (statsLine || 'no results yet') + '</div>' +
      '  </div>' +
      '  <div>' + buttonsHtml + '</div>' +
      '</div>';
  } else if (pendingGogCount > 0) {
    batchInfo.style.display = 'block';
    batchInfo.innerHTML =
      '<div style="background:#0f3460;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">' +
      '  <div style="flex:1"><b>' + pendingGogCount + ' pending GOG code' + (pendingGogCount === 1 ? '' : 's') + '</b> — solve captcha once, remaining auto-process</div>' +
      '  <button class="btn btn-run" onclick="startBatchRedeem()">Batch Redeem</button>' +
      '</div>';
  } else {
    batchInfo.style.display = 'none';
  }

  const stepLabels = ['Check sessions', 'Log in to sites', 'First run', 'Done!'];
  steps.innerHTML = stepLabels.map((label, i) => {
    const num = i + 1;
    let cls = 'step';
    if (currentStep === 'waiting') {
      if (num <= 2) cls += ' done';
      else if (num === 3) cls += ' waiting';
    } else {
      if (num < currentStep) cls += ' done';
      else if (num === currentStep) cls += ' active';
    }
    if (num === 4 && state.allLoggedIn && state.lastRun) cls += ' done';
    return (i > 0 ? '<span class="step-arrow">&rarr;</span>' : '') + '<span class="' + cls + '">' + num + '. ' + label + '</span>';
  }).join('');

  // Once all sessions are OK the stepper is no longer actionable — the strip
  // below communicates current state more compactly. Also hide stepper + cards
  // during an active login (so the VNC iframe has more room) or whenever the
  // user has clicked the chevron in the status strip to collapse the session
  // panel manually.
  steps.style.display = (state.allLoggedIn || state.activeBrowser || sessionsCollapsed) ? 'none' : 'flex';
  cards.style.display = (state.activeBrowser || sessionsCollapsed) ? 'none' : 'grid';

  const isRunning = state.runStatus === 'running';
  const disabled = busy || !!state.activeBrowser || isRunning;
  btnCheckAll.disabled = disabled;
  btnRunAll.disabled = disabled && !isRunning;

  if (isRunning) {
    btnRunAll.textContent = 'Stop Scripts';
    btnRunAll.className = 'btn btn-stop';
    btnRunAll.disabled = false;
    btnRunAll.onclick = stopRun;
  } else {
    btnRunAll.textContent = 'Run Now';
    btnRunAll.className = 'btn btn-run';
    btnRunAll.onclick = runAll;
  }

  // Placeholder: swap between first-time setup instructions and a shorter
  // "ready" message when all sessions are logged in. Leaving the main area
  // empty was confusing — there's no banner anymore, and the VNC iframe only
  // appears during active login or claim runs.
  const btnShowBrowser = document.getElementById('btnShowBrowser');
  if (btnShowBrowser) {
    // Login + batch-redeem flows already mount the iframe themselves and
    // would break if we removed it — show the button disabled with a label
    // that matches the actual state.
    const ownedElsewhere = !!(state.activeBrowser || state.batchRedeem);
    btnShowBrowser.disabled = ownedElsewhere;
    btnShowBrowser.textContent = ownedElsewhere ? 'Browser shown' : (userShowBrowser ? 'Hide browser' : 'Show browser');
    btnShowBrowser.classList.toggle('active', userShowBrowser || ownedElsewhere);
  }
  const btnPopoutBrowser = document.getElementById('btnPopoutBrowser');
  if (btnPopoutBrowser) {
    // Pop out only makes sense as a follow-up to Show browser — it'd be noise
    // (or worse, a dead link in degraded networks) if always visible.
    const iframeMounted = !!(userShowBrowser || state.activeBrowser || state.batchRedeem);
    btnPopoutBrowser.style.display = iframeMounted ? '' : 'none';
  }

  const placeholder = document.getElementById('vncPlaceholder');
  if (placeholder && !state.activeBrowser && !state.batchRedeem && !showingLog && !userShowBrowser) {
    placeholder.style.display = 'flex';
    const wrap = inner => '<div style="max-width:520px;font-size:14px;line-height:1.7;color:#a0b4d4">' + inner + '</div>';
    if (state.startupAutoCheck) {
      placeholder.innerHTML = wrap('Checking sessions (' + state.startupAutoCheck.current + '/' + state.startupAutoCheck.total + ')…');
    } else if (state.allLoggedIn && state.sites.length > 0) {
      // Status strip in the header already communicates "all sessions OK" —
      // don't repeat it here. Just explain what this empty space is for.
      placeholder.innerHTML = wrap(
        'Click <b style="color:#e0e0e0">Run Now</b> to trigger an immediate claim, or let the scheduler (if enabled) handle it.<br><br>' +
        'Click <b style="color:#e0e0e0">Login</b> on a session card or <b style="color:#e0e0e0">Show browser</b> in the header to mount the live browser view here. ' +
        'Run output streams in the <b style="color:#e0e0e0">Logs</b> tab.'
      );
    } else {
      const activeSites = state.sites.filter(s => s.active !== false);
      const need = activeSites.filter(s => s.status === 'not_logged_in').length;
      const total = activeSites.length;
      if (need > 0) {
        placeholder.innerHTML = wrap(
          '<b style="color:#e94560">' + need + ' of ' + total + ' session' + (total === 1 ? '' : 's') + ' need' + (need === 1 ? 's' : '') + ' login.</b><br><br>' +
          'Click <b style="color:#e0e0e0">Login</b> on a red card — the browser will appear here so you can sign in (captchas, MFA, etc.).<br>' +
          'When done, click <span class="highlight">"I\\'m Logged In"</span> to save the session.'
        );
      } else {
        // Sites haven't all settled yet (some 'unknown' or 'error') and the
        // startupAutoCheck flag isn't set — render a neutral message rather
        // than the stale tutorial that used to live here.
        placeholder.innerHTML = wrap('Checking sessions…');
      }
    }
  }

  // Status strip — one line that rolls up the old green banner + "Next run" line.
  // Counts active services only; deactivated ones don't affect "All sessions OK".
  const activeSites = state.sites.filter(s => s.active !== false);
  const totalCount = activeSites.length;
  const secondaryParts = [];
  if (!isRunning && state.nextScheduledRun) secondaryParts.push('Next run ' + formatTimestamp(state.nextScheduledRun, 'relative'));
  if (state.lastRun) {
    const dur = state.lastRun.durationSec != null ? Math.round(state.lastRun.durationSec / 60) + 'm' : '';
    secondaryParts.push('Last run ' + formatTimestamp(state.lastRun.at, 'relative') + ' (' + state.lastRun.status + (dur ? ', ' + dur : '') + ')');
  }
  let stripSecondary = secondaryParts.join(' · ');
  let stripKind = 'info';
  let stripText = null;
  if (state.startupAutoCheck) {
    stripKind = 'warn';
    stripText = '⏳ Startup: checking sessions (' + state.startupAutoCheck.current + '/' + state.startupAutoCheck.total + ') — ' + state.startupAutoCheck.siteName + '…';
    stripSecondary = '';
  } else if (state.activeBrowser) {
    stripText = null; // activeSession row owns this state
  } else if (isRunning) {
    stripKind = 'warn';
    const src = state.runSource === 'scheduler' ? 'scheduler' : 'manual';
    stripText = '● Run in progress (' + src + ')…';
  } else if (activeSites.some(s => s.status === 'not_logged_in')) {
    stripKind = 'err';
    const missing = activeSites.filter(s => s.status === 'not_logged_in').map(s => s.name).join(', ');
    stripText = '● Login needed for: ' + missing;
  } else if (state.allLoggedIn && totalCount > 0) {
    const label = totalCount === 1 ? 'session' : 'sessions';
    if (state.runStatus === 'finished') {
      stripKind = 'warn';
      stripText = '● All ' + totalCount + ' ' + label + ' OK · last run had errors — check Logs';
    } else {
      stripKind = 'ok';
      stripText = '● All ' + totalCount + ' ' + label + ' OK';
    }
  } else if (totalCount > 0) {
    stripKind = 'info';
    stripText = 'Click "Check All Sessions" to get started';
  }

  if (stripText && !sessionsCollapsed) {
    strip.style.display = 'flex';
    strip.className = 'status-strip sessions-only ' + stripKind;
    strip.innerHTML =
      '<span class="strip-primary">' + stripText + '</span>' +
      (stripSecondary ? '<span class="strip-secondary">' + stripSecondary + '</span>' : '');
  } else {
    strip.style.display = 'none';
  }

  // Compact session row — replaces the full cards strip when collapsed.
  // One mini-card per active service: name + status glyph (✓ / ✕ / ? / !).
  const compact = document.getElementById('compactSessions');
  if (compact) {
    if (sessionsCollapsed) {
      compact.classList.add('shown');
      const glyphFor = s =>
        s.status === 'logged_in'      ? '✓' :
        s.status === 'not_logged_in'  ? '✕' :
        s.status === 'error'          ? '!' :
                                        '?';
      compact.innerHTML = activeSites.map(s =>
        '<span class="mini-card ' + s.status + '" title="' + s.name + ': ' + s.status.replace('_', ' ') + '">' +
          escapeHtml(s.name) +
          '<span class="mini-glyph">' + glyphFor(s) + '</span>' +
        '</span>'
      ).join('');
    } else {
      compact.classList.remove('shown');
      compact.innerHTML = '';
    }
  }
  const btnHeaderCollapse = document.getElementById('btnHeaderCollapse');
  if (btnHeaderCollapse) {
    btnHeaderCollapse.textContent = sessionsCollapsed ? '▾' : '▴';
    const t = sessionsCollapsed ? 'Expand session details' : 'Collapse session details';
    btnHeaderCollapse.title = t;
    btnHeaderCollapse.setAttribute('aria-label', t);
  }

  // Captcha banner — shows on every tab when a runner has flagged a captcha.
  // Click drops the user straight into Sessions tab + collapsed + browser shown.
  const captchaBanner = document.getElementById('captchaBanner');
  if (captchaBanner) {
    if (state.captchaPending) {
      captchaBanner.style.display = 'flex';
      const since = state.captchaPending.since
        ? ' · started ' + formatTimestamp(state.captchaPending.since, 'relative')
        : '';
      captchaBanner.innerHTML =
        '<span class="cb-icon">⚠</span>' +
        '<span class="cb-text">' +
          escapeHtml(state.captchaPending.service) + ' captcha — ' +
          escapeHtml(state.captchaPending.label) + since +
        '</span>' +
        '<span class="cb-cta">Open browser →</span>';
    } else {
      captchaBanner.style.display = 'none';
    }
  }

  // Split sites into active (main grid) and inactive (drawer below).
  const activeCards = state.sites.filter(s => s.active !== false);
  const inactiveCards = state.sites.filter(s => s.active === false);

  cards.innerHTML = activeCards.map(s => {
    const dotClass = s.status === 'logged_in' ? 'logged-in' : s.status === 'not_logged_in' ? 'not-logged-in' : s.status === 'error' ? 'error' : 'unknown';
    const statusClass = dotClass;
    let statusText = 'Not checked';
    if (s.status === 'logged_in') statusText = 'Logged in' + (s.user ? ' as ' + s.user : '');
    else if (s.status === 'not_logged_in') statusText = 'Not logged in';
    else if (s.status === 'error') statusText = 'Error checking';
    if (s.checkedAt) statusText += ' (' + String(s.checkedAt).slice(11, 19) + ')';
    return '<div class="site-card">' +
      '<div class="site-card-header">' +
        '<div class="dot ' + dotClass + '"></div>' +
        '<div class="name">' + s.name + '</div>' +
      '</div>' +
      '<div class="status ' + statusClass + '">' + statusText + '</div>' +
      '<div class="card-actions">' +
        '<button class="btn btn-login" onclick="launchSite(\\'' + s.id + '\\')" ' + (disabled ? 'disabled' : '') + '>Login</button>' +
        '<button class="btn btn-check" onclick="checkSite(\\'' + s.id + '\\')" ' + (disabled ? 'disabled' : '') + '>Check</button>' +
        '<button class="btn btn-run-single" onclick="runSite(\\'' + s.id + '\\')" ' + (disabled ? 'disabled' : '') + ' title="Run this service now">Run</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // "Available services" drawer — inactive sites with a single Enable button.
  const drawer = document.getElementById('availableDrawer');
  if (drawer) {
    if (inactiveCards.length === 0 || sessionsCollapsed) {
      drawer.style.display = 'none';
    } else {
      drawer.style.display = 'block';
      const expanded = drawerExpanded;
      const cardsHtml = inactiveCards.map(s =>
        '<div class="site-card card-inactive">' +
          '<div class="site-card-header">' +
            '<div class="dot unknown"></div>' +
            '<div class="name">' + s.name + '</div>' +
          '</div>' +
          '<div class="status">Not active — enable to start using this service.</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-run" onclick="enableService(\\'' + s.id + '\\')">Enable</button>' +
          '</div>' +
        '</div>'
      ).join('');
      drawer.innerHTML =
        '<button class="drawer-head" onclick="toggleAvailableDrawer()" aria-expanded="' + expanded + '">' +
          '<span class="caret">' + (expanded ? '▾' : '▸') + '</span> ' +
          inactiveCards.length + ' service' + (inactiveCards.length === 1 ? '' : 's') + ' available' +
        '</button>' +
        '<div class="drawer-body" ' + (expanded ? '' : 'hidden') + '>' + cardsHtml + '</div>';
    }
  }

  if (state.activeBrowser) {
    session.style.display = 'flex';
    session.innerHTML =
      '<div class="label">Active:</div>' +
      '<div class="site-name">' + state.activeBrowser.name + ' - Complete the login in the browser below, then click "I\\\'m Logged In"</div>' +
      '<div class="card-actions">' +
        '<button class="btn btn-verify" onclick="verifyLogin()" ' + (busy ? 'disabled' : '') + '>I\\'m Logged In</button>' +
        '<button class="btn btn-cancel" onclick="cancelLogin()" ' + (busy ? 'disabled' : '') + '>Cancel</button>' +
      '</div>';
    showVnc();
  } else {
    session.style.display = 'none';
  }
}

// Build the noVNC URL appropriate for the current deployment. Used both by
// the embedded iframe and the "Pop out" new-tab button so they stay in sync.
// Through a reverse proxy (BASE_PATH set) noVNC is proxied at BASE_PATH/novnc/
// and the WebSocket path must be told to noVNC explicitly — by default it
// assumes "/websockify" at the origin root, which won't exist when proxied at
// a subfolder. For direct access (no BASE_PATH) the container's noVNC port is
// reachable at the same host.
function buildNovncUrl() {
  if (BASE_PATH) {
    const wsPath = BASE_PATH.replace(/^\\//, '') + '/novnc/websockify';
    return BASE_PATH + '/novnc/vnc.html?autoconnect=true&resize=scale&path=' + encodeURIComponent(wsPath);
  }
  return location.protocol + '//' + location.hostname + ':' + NOVNC_PORT + '/vnc.html?autoconnect=true&resize=scale';
}

function showVnc() {
  hideRunLog();
  const container = document.getElementById('vncContainer');
  const placeholder = document.getElementById('vncPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  if (!container.querySelector('iframe')) {
    const iframe = document.createElement('iframe');
    iframe.src = buildNovncUrl();
    container.appendChild(iframe);
  }
}

function popoutBrowser() {
  window.open(buildNovncUrl(), '_blank', 'noopener');
}

// Drop the user straight onto the captcha. Used by both the in-panel banner
// click and the ?focus=captcha deep link from notification pushes — the link
// arrives via a phone or whatever and we want the next tap to be solving the
// challenge, not navigating tabs.
function focusCaptcha() {
  if (document.body.dataset.tab !== 'sessions') switchTab('sessions');
  if (!sessionsCollapsed) {
    sessionsCollapsed = true;
    localStorage.setItem('sessionsCollapsed', '1');
  }
  if (!userShowBrowser && !state.activeBrowser && !state.batchRedeem) {
    userShowBrowser = true;
    showVnc();
  }
  render();
}

function hideVnc() {
  const container = document.getElementById('vncContainer');
  const iframe = container.querySelector('iframe');
  if (iframe) iframe.remove();
  const placeholder = document.getElementById('vncPlaceholder');
  if (placeholder) placeholder.style.display = 'flex';
  // Iframe was just removed externally (login ended, batch finished). The
  // user-toggle state must follow or the button label will lie.
  userShowBrowser = false;
}

// Header "Show browser" toggle. Lets the user peek at the live noVNC view
// regardless of run state — during a claim run the iframe normally gets
// swapped out for the run log, but the user may want to see what the
// browser is actually doing (e.g. when MS card clicks all time out).
// No-op during active login / batch redeem — those flows own the iframe
// and removing it here would break them.
function toggleBrowserView() {
  if (state.activeBrowser || state.batchRedeem) return;
  userShowBrowser = !userShowBrowser;
  if (userShowBrowser) {
    showVnc(); // mounts iframe; also calls hideRunLog() which hides the log el
  } else {
    const container = document.getElementById('vncContainer');
    const iframe = container.querySelector('iframe');
    if (iframe) iframe.remove();
    // Don't auto-restore the run log here — earlier versions did, but a user
    // peeking at the browser mid-run then closing got jarring "log bleed-
    // through" on the Sessions tab. The Logs tab is one click away if they
    // want it; render() falls through to the placeholder.
  }
  render();
}

function showRunLog() {
  showingLog = true;
  const container = document.getElementById('vncContainer');
  const placeholder = document.getElementById('vncPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  const iframe = container.querySelector('iframe');
  if (iframe) iframe.style.display = 'none';
  let logEl = document.getElementById('runLog');
  if (!logEl) {
    logEl = document.createElement('div');
    logEl.id = 'runLog';
    logEl.className = 'run-log';
    container.appendChild(logEl);
  }
  logEl.style.display = 'block';
  pollLog();
}

function hideRunLog() {
  showingLog = false;
  if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
  const logEl = document.getElementById('runLog');
  if (logEl) logEl.style.display = 'none';
  const iframe = document.getElementById('vncContainer')?.querySelector('iframe');
  if (iframe) iframe.style.display = 'block';
}

async function pollLog() {
  if (!showingLog) return;
  try {
    const r = await api('GET', '/run-log?since=' + logOffset);
    const logEl = document.getElementById('runLog');
    if (logEl && r.lines.length) {
      r.lines.forEach(l => {
        const div = document.createElement('div');
        div.className = 'line ' + l.type;
        const timeSpan = '<span class="time">' + (l.time ? String(l.time).slice(11, 19) : '') + '</span>';
        div.innerHTML = timeSpan + escapeHtml(l.text);
        logEl.appendChild(div);
      });
      logEl.scrollTop = logEl.scrollHeight;
      logOffset = r.total;
    }
    if (r.status === 'running') {
      logPollTimer = setTimeout(pollLog, 1000);
    } else {
      await refreshState();
    }
  } catch {
    logPollTimer = setTimeout(pollLog, 2000);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// One-shot guard for the ?focus=captcha deep link — applied after the first
// successful state load (so we know which tab/collapsed state is current)
// and the URL param is then stripped so a refresh doesn't re-trigger.
let initialUrlFocusApplied = false;
function applyUrlFocus() {
  if (initialUrlFocusApplied) return;
  initialUrlFocusApplied = true;
  const params = new URLSearchParams(location.search);
  if (params.get('focus') === 'captcha') {
    focusCaptcha();
    params.delete('focus');
    const search = params.toString();
    history.replaceState({}, '', location.pathname + (search ? '?' + search : ''));
  }
}

async function refreshState() {
  try {
    state = await api('GET', '/state');
    render();
    if (typeof updateBatchPolling === 'function') updateBatchPolling();
    applyUrlFocus();
  } catch {}
}

async function launchSite(siteId) {
  busy = true; render();
  try {
    const r = await api('POST', '/launch', { site: siteId });
    if (r.success) {
      showToast('Browser launched for ' + r.name + '. Log in now!', 'success');
    } else {
      showToast(r.error || 'Failed to launch browser.', 'error');
    }
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function verifyLogin() {
  busy = true; render();
  try {
    const r = await api('POST', '/verify');
    if (r.loggedIn) {
      showToast('Logged in as ' + r.user + '! Session saved.', 'success');
      hideVnc();
    } else {
      showToast(r.message || 'Login not detected. Keep trying.', 'error');
    }
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function cancelLogin() {
  busy = true; render();
  try {
    await api('POST', '/close');
    showToast('Browser closed.', 'info');
    hideVnc();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function checkSite(siteId) {
  busy = true; render();
  const siteName = state.sites.find(s => s.id === siteId)?.name || siteId;
  showToast('Checking ' + siteName + '...', 'info', 2000);
  try {
    const r = await api('POST', '/check', { site: siteId });
    if (r.error) showToast(r.error, 'error');
    else if (r.loggedIn) showToast(siteName + ': logged in as ' + r.user, 'success');
    else showToast(siteName + ': not logged in', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function checkAll() {
  busy = true; render();
  showToast('Checking all sessions...', 'info', 3000);
  try {
    await api('POST', '/check-all');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function runSite(siteId) {
  const siteName = state.sites.find(s => s.id === siteId)?.name || siteId;
  busy = true; render();
  try {
    const r = await api('POST', '/run-service', { site: siteId });
    if (r && r.success === false) {
      showToast(r.error || 'Run failed', 'error', 5000);
    } else {
      showToast('Started ' + siteName + ' — open the Logs tab to watch output.', 'success', 4000);
    }
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function runAll() {
  busy = true; render();
  try {
    const r = await api('POST', '/run-all');
    if (r.success) {
      logOffset = 0;
      showRunLog();
      showToast('Scripts started! Watch the output below.', 'success');
    } else {
      showToast(r.error || 'Failed to start scripts.', 'error');
    }
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function stopRun() {
  try {
    await api('POST', '/stop-run');
    showToast('Scripts stopped.', 'info');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  await refreshState();
}

async function startBatchRedeem() {
  busy = true; render();
  try {
    const r = await api('POST', '/batch-redeem/start');
    if (r.success) {
      showToast('Batch redeem started — ' + r.total + ' code(s) queued. Solve captcha in the browser when prompted.', 'success');
      showVnc();
    } else {
      showToast(r.error || 'Failed to start batch redeem.', 'error');
    }
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  busy = false;
  await refreshState();
}

async function stopBatchRedeem() {
  try {
    await api('POST', '/batch-redeem/stop');
    showToast('Batch redeem stopped.', 'info');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  await refreshState();
}

async function clearBatchRedeem() {
  try {
    await api('POST', '/batch-redeem/clear');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  await refreshPendingGogCount();
  await refreshState();
}

// Faster poll when batch-redeem is active so progress updates feel live.
let batchPollTimer = null;
function updateBatchPolling() {
  const active = state.batchRedeem && (state.batchRedeem.phase === 'running' || state.batchRedeem.phase === 'awaiting-captcha');
  if (active && !batchPollTimer) {
    batchPollTimer = setInterval(refreshState, 2000);
    showVnc();
  } else if (!active && batchPollTimer) {
    clearInterval(batchPollTimer);
    batchPollTimer = null;
  }
}

async function handleDeepLink() {
  // Deep-links from Pushover notifications:
  //   ?login=<siteId>  → auto-open the Login flow for that site
  //   ?batch=gog       → auto-start batch redeem for pending GOG codes
  // After triggering, strip the query so a refresh doesn't re-fire.
  const params = new URLSearchParams(location.search);
  const loginSite = params.get('login');
  const batch = params.get('batch');
  if (!loginSite && !batch) return;
  const stripQuery = () => {
    const url = location.pathname + location.hash;
    history.replaceState(null, '', url);
  };
  // Wait for state to have loaded so busy-checks are accurate.
  if (loginSite) {
    if (state.sites.find(s => s.id === loginSite)) {
      showToast('Opening Login flow for ' + loginSite + '…', 'info');
      stripQuery();
      await launchSite(loginSite);
    } else {
      showToast('Unknown site: ' + loginSite, 'error');
      stripQuery();
    }
  } else if (batch === 'gog') {
    if (pendingGogCount > 0 && !state.batchRedeem) {
      showToast('Starting batch redeem…', 'info');
      stripQuery();
      await startBatchRedeem();
    } else if (state.batchRedeem) {
      showToast('Batch redeem already running.', 'info');
      stripQuery();
    } else {
      showToast('No pending GOG codes to redeem.', 'info');
      stripQuery();
    }
  }
}

async function initialLoad() {
  await refreshPendingGogCount();
  await refreshState();
  updateBatchPolling();
  await handleDeepLink();
  fetch(BASE_PATH + '/api/accounts').then(r => r.json()).then(accounts => {
    const hasCreds = accounts.some(a => Object.keys(a.env || {}).length > 0);
    if (hasCreds) document.getElementById('cred-warn').style.display = 'block';
  }).catch(() => {});
}
initialLoad();
setInterval(async () => {
  await refreshState();
  if (!state.batchRedeem) await refreshPendingGogCount();
  updateBatchPolling();
}, 10000);

// ── Library tab ──────────────────────────────────────────────────────────────
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
  const res = await fetch(BASE_PATH + '/api/library?' + params);
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
  const blob = new Blob([[hdr, ...rows].join('\\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'library.csv';
  a.click();
});

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
    await fetch(BASE_PATH + '/api/accounts/' + encodeURIComponent(acct.id), { method: 'DELETE' });
    loadAccounts();
  });
  div.appendChild(info);
  div.appendChild(del);
  return div;
}

async function loadAccounts() {
  const res = await fetch(BASE_PATH + '/api/accounts');
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
  for (const line of (fd.get('env') || '').split('\\n').filter(Boolean)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const acct = {
    id: fd.get('id').trim(), label: fd.get('label').trim(),
    browserDir: fd.get('browserDir').trim(),
    services: (fd.get('services') || '').split(',').map(s => s.trim()).filter(Boolean),
    env,
  };
  const res = await fetch(BASE_PATH + '/api/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(acct),
  });
  if (res.ok) { e.target.reset(); loadAccounts(); }
  else { const j = await res.json(); alert('Error: ' + j.error); }
});

</script>
</body>
</html>`;
