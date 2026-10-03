const { test } = require('node:test');
const assert = require('node:assert/strict');

test('voice starts exactly once after two seconds and push release stops it', () => {
  const { createHold, HOLD_MS } = require('../desktop/shortcut.cjs');
  assert.equal(HOLD_MS, 2000);
  const hold = createHold('push');
  assert.ok(!hold.advance(true, 1999).some(event => event.event === 'voice'));
  assert.deepEqual(hold.advance(true, 2000), [{ event: 'hold', data: { progress: 1 } }, { event: 'voice', data: { action: 'start' } }]);
  assert.equal(hold.advance(true, 3000).length, 0);
  assert.deepEqual(hold.advance(false, 3100), [{ event: 'hold', data: { progress: 0 } }, { event: 'voice', data: { action: 'stop' } }]);
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
  assert.ok(next.advance(true, 2000).some(event => event.event === 'voice'));
});
