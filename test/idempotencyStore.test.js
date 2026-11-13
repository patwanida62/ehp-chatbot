const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdempotencyStore } = require('../src/services/idempotencyStore');

function fakeClock(start = 0) {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

test('reserve returns true the first time and false for a repeated key', () => {
  const store = createIdempotencyStore();

  assert.equal(store.reserve('app:1'), true);
  assert.equal(store.reserve('app:1'), false);
  assert.equal(store.reserve('app:2'), true);
});

test('release lets the same key be reserved again', () => {
  const store = createIdempotencyStore();
  store.reserve('app:1');

  store.release('app:1');

  assert.equal(store.reserve('app:1'), true);
});

test('keys expire after the TTL', () => {
  const clock = fakeClock();
  const store = createIdempotencyStore({ ttlMs: 1000, now: clock.now });
  store.reserve('app:1');

  clock.advance(1000);

  assert.equal(store.reserve('app:1'), true);
});

test('oldest keys are evicted when maxEntries is reached', () => {
  const store = createIdempotencyStore({ maxEntries: 2 });
  store.reserve('a');
  store.reserve('b');

  store.reserve('c');

  assert.equal(store.reserve('a'), true, '"a" was evicted');
  assert.equal(store.reserve('c'), false, '"c" is still remembered');
});
