import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getByPath, setByPath, deleteByPath } from '../src/app-config.js';

test('getByPath retrieves deeply nested value', () => {
  assert.equal(getByPath({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
});

test('getByPath returns undefined for missing path', () => {
  assert.equal(getByPath({}, 'a.b'), undefined);
  assert.equal(getByPath({ a: null }, 'a.b'), undefined);
});

test('setByPath creates nested structure', () => {
  const obj = {};
  setByPath(obj, 'a.b.c', 99);
  assert.deepEqual(obj, { a: { b: { c: 99 } } });
});

test('setByPath overwrites existing value', () => {
  const obj = { a: { b: 1 } };
  setByPath(obj, 'a.b', 2);
  assert.equal(obj.a.b, 2);
});

test('deleteByPath removes key and prunes empty parents', () => {
  const obj = { a: { b: { c: 1 } } };
  deleteByPath(obj, 'a.b.c');
  assert.deepEqual(obj, {});
});

test('deleteByPath leaves non-empty siblings', () => {
  const obj = { a: { b: 1, c: 2 } };
  deleteByPath(obj, 'a.b');
  assert.deepEqual(obj, { a: { c: 2 } });
});

test('deleteByPath is a no-op for missing path', () => {
  const obj = { a: 1 };
  deleteByPath(obj, 'x.y.z');
  assert.deepEqual(obj, { a: 1 });
});
