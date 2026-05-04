import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, LIBRARY_STATUSES } from '../src/panel/library.js';

test('normalizeEntry maps a claimed record correctly', () => {
  const result = normalizeEntry('epic-games', '', 'control', {
    title: 'Control', status: 'claimed',
    time: '2024-01-15 10:30:00',
    url: 'https://store.epicgames.com/en-US/p/control',
  });
  assert.deepEqual(result, {
    title: 'Control', platform: 'epic-games', status: 'claimed',
    time: '2024-01-15 10:30:00',
    url: 'https://store.epicgames.com/en-US/p/control', user: '',
  });
});

test('normalizeEntry uses id as title when title is absent', () => {
  const result = normalizeEntry('gog', '', 'control', { status: 'existed', time: '', url: '' });
  assert.equal(result.title, 'control');
});

test('normalizeEntry returns null for excluded statuses', () => {
  assert.equal(normalizeEntry('steam', '', 'x', { status: 'failed' }), null);
  assert.equal(normalizeEntry('steam', '', 'x', { status: 'skipped' }), null);
  assert.equal(normalizeEntry('steam', '', 'x', { status: 'ignored' }), null);
});

test('normalizeEntry returns null for null record', () => {
  assert.equal(normalizeEntry('gog', '', 'x', null), null);
});

test('LIBRARY_STATUSES includes claimed, existed, manual', () => {
  assert.ok(LIBRARY_STATUSES.has('claimed'));
  assert.ok(LIBRARY_STATUSES.has('existed'));
  assert.ok(LIBRARY_STATUSES.has('manual'));
  assert.ok(!LIBRARY_STATUSES.has('failed'));
  assert.ok(!LIBRARY_STATUSES.has('skipped'));
});
