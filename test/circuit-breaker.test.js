import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCBHelpers } from '../src/panel/circuit-breaker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function tempCB() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fgc-cb-'));
  const file = path.join(dir, 'cb.json');
  const cb = makeCBHelpers(file);
  return { cb, cleanup: () => rmSync(dir, { recursive: true }) };
}

test('CLOSED by default (no state)', () => {
  const { cb, cleanup } = tempCB();
  try {
    assert.equal(cb.isOpen('epic-games', cb.readState()), false);
  } finally { cleanup(); }
});

test('CLOSED stays CLOSED below threshold', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    cb.recordFailure('gog', s, 3, 8); s = cb.readState();
    assert.equal(cb.isOpen('gog', s), false);
    cb.recordFailure('gog', s, 3, 8); s = cb.readState();
    assert.equal(cb.isOpen('gog', s), false);
  } finally { cleanup(); }
});

test('CLOSED transitions to OPEN at threshold', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    for (let i = 0; i < 3; i++) { cb.recordFailure('gog', s, 3, 8); s = cb.readState(); }
    assert.equal(cb.isOpen('gog', s), true);
    assert.ok(s['gog'].openUntil);
  } finally { cleanup(); }
});

test('OPEN transitions to CLOSED on success', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    cb.recordFailure('steam', s, 1, 8); s = cb.readState();
    assert.equal(cb.isOpen('steam', s), true);
    cb.recordSuccess('steam', s); s = cb.readState();
    assert.equal(cb.isOpen('steam', s), false);
    assert.equal(s['steam'].failures, 0);
    assert.equal(s['steam'].openUntil, null);
  } finally { cleanup(); }
});

test('HALF-OPEN: expired openUntil reads as closed', () => {
  const { cb, cleanup } = tempCB();
  try {
    let s = cb.readState();
    s['gog'] = { failures: 3, openUntil: new Date(Date.now() - 1000).toISOString() };
    cb.writeState(s); s = cb.readState();
    assert.equal(cb.isOpen('gog', s), false);
  } finally { cleanup(); }
});
