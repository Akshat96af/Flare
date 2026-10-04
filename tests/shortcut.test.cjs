const { test } = require('node:test');
const assert = require('node:assert/strict');

test('voice starts exactly once after one second and push release stops it', () => {
  const { createHold, HOLD_MS } = require('../desktop/shortcut.cjs');
  assert.equal(HOLD_MS, 1000);
  const hold = createHold('push');
  assert.ok(!hold.advance(true, 999).some((event) => event.event === 'voice'));
  assert.deepEqual(hold.advance(true, 1000), [
    { event: 'hold', data: { progress: 1 } },
    { event: 'voice', data: { action: 'start' } },
  ]);
  assert.equal(hold.advance(true, 3000).length, 0);
  assert.deepEqual(hold.advance(false, 3100), [
    { event: 'hold', data: { progress: 0 } },
    { event: 'voice', data: { action: 'stop' } },
  ]);
  assert.equal(hold.done, true);
});
test('dismissed holds cannot activate a hidden microphone and can rearm after release', () => {
  const { createHold } = require('../desktop/shortcut.cjs');
  const hold = createHold('auto');
  hold.advance(true, 700);
  hold.cancel();
  assert.deepEqual(hold.advance(true, 2100), []);
  assert.deepEqual(hold.advance(false, 2200), [{ event: 'hold', data: { progress: 0 } }]);
  assert.equal(hold.done, true);
  const next = createHold('auto');
  assert.ok(next.advance(true, 1000).some((event) => event.event === 'voice'));
});

test('short taps never start voice and silence-stop does not stop on release', () => {
  const { createHold } = require('../desktop/shortcut.cjs');
  const tap = createHold('push');
  assert.ok(!tap.advance(true, 700).some((x) => x.event === 'voice'));
  assert.deepEqual(tap.advance(false, 701), [{ event: 'hold', data: { progress: 0 } }]);
  assert.deepEqual(tap.advance(true, 2000), []);
  const automatic = createHold('auto');
  assert.ok(automatic.advance(true, 2000).some((x) => x.event === 'voice'));
  assert.deepEqual(automatic.advance(false, 2200), [{ event: 'hold', data: { progress: 0 } }]);
});
