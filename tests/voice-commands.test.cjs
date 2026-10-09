const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interpretLocal } = require('../desktop/commands.cjs');
test('spoken punctuation and common percentages work without a model', () => {
  assert.equal(interpretLocal('Open YouTube.').kind, 'website');
  assert.deepEqual(interpretLocal('Set the volume to fifty percent.'), {
    kind: 'system',
    command: 'volume',
    value: 50,
  });
  assert.deepEqual(interpretLocal('Brightness max!'), {
    kind: 'system',
    command: 'brightness',
    value: 100,
  });
  assert.equal(interpretLocal('volume mute').value, 0);
  assert.equal(interpretLocal('volume halfwayish'), null);
});
