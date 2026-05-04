import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../util.js';

export const ACCOUNTS_FILE = dataDir('accounts.json');

const CRED_PATTERN = /password|otpkey|token|secret|key$/i;

export function readAccounts() {
  try {
    if (!existsSync(ACCOUNTS_FILE)) return [];
    return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) || [];
  } catch { return []; }
}

export function writeAccounts(accounts) {
  mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  const tmp = ACCOUNTS_FILE + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(accounts, null, 2) + '\n');
  renameSync(tmp, ACCOUNTS_FILE);
}

export function maskAccountCredentials(account) {
  const masked = { ...account, env: { ...account.env } };
  for (const k of Object.keys(masked.env || {})) {
    if (CRED_PATTERN.test(k)) {
      const v = masked.env[k];
      if (typeof v === 'string' && v.length > 4) masked.env[k] = '••••' + v.slice(-4);
    }
  }
  return masked;
}

export function getEffectiveAccounts() {
  const configured = readAccounts();
  const hasEnvCred = process.env.EMAIL || process.env.EG_EMAIL || process.env.GOG_EMAIL || process.env.STEAM_EMAIL;
  const envAccount = hasEnvCred
    ? [{ id: '_env', label: 'Default (env vars)', browserDir: null, services: [], env: {} }]
    : [];
  return [...envAccount, ...configured];
}
