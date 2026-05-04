import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, escapeHtml, filenamify, parsePrice } from '../src/util.js';

test('normalizeTitle lowercases and collapses separators', () => {
  assert.equal(normalizeTitle('The Last of Us: Part II'), 'the last of us part ii');
  assert.equal(normalizeTitle('Hades – Supergiant'), 'hades supergiant');
  assert.equal(normalizeTitle('  spaces  '), 'spaces');
});

test('normalizeTitle strips punctuation', () => {
  assert.equal(normalizeTitle('Tomb Raider™ (2013)'), 'tomb raider 2013');
});

test('normalizeTitle handles null and empty', () => {
  assert.equal(normalizeTitle(''), '');
  assert.equal(normalizeTitle(null), '');
});

test('escapeHtml escapes angle brackets and quotes', () => {
  assert.equal(escapeHtml('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(escapeHtml("it's & done"), "it&#039;s &amp; done");
});

test('filenamify replaces colons with dots', () => {
  assert.equal(filenamify('2024-01-01T12:00:00'), '2024-01-01T12.00.00');
});

test('parsePrice parses US decimal format', () => {
  assert.equal(parsePrice('$19.99'), 19.99);
  assert.equal(parsePrice('1,299.00'), 1299.00);
});

test('parsePrice parses EU comma-decimal format', () => {
  assert.equal(parsePrice('19,99 €'), 19.99);
  assert.equal(parsePrice('1.299,00'), 1299.00);
});

test('parsePrice returns null for non-numeric input', () => {
  assert.equal(parsePrice('Free'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
});
