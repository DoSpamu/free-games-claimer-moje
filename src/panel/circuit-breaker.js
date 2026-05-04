import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function makeCBHelpers(cbFilePath) {
  const dir = path.dirname(cbFilePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  function readState() {
    try {
      if (!existsSync(cbFilePath)) return {};
      return JSON.parse(readFileSync(cbFilePath, 'utf8')) || {};
    } catch { return {}; }
  }

  function writeState(state) {
    try { writeFileSync(cbFilePath, JSON.stringify(state, null, 2) + '\n'); }
    catch (e) { console.error('[circuit-breaker] write failed:', e.message); }
  }

  function isOpen(service, state) {
    const s = state[service];
    return !!(s?.openUntil && new Date(s.openUntil) > new Date());
  }

  function openUntil(service, state) {
    return state[service]?.openUntil || null;
  }

  function recordSuccess(service, state) {
    state[service] = { failures: 0, openUntil: null };
    writeState(state);
  }

  function recordFailure(service, state, threshold, cooldownHours) {
    if (!state[service]) state[service] = { failures: 0, openUntil: null };
    state[service].failures = (state[service].failures || 0) + 1;
    if (state[service].failures >= threshold) {
      state[service].openUntil = new Date(Date.now() + cooldownHours * 3600 * 1000).toISOString();
    }
    writeState(state);
  }

  return { readState, writeState, isOpen, openUntil, recordSuccess, recordFailure };
}
