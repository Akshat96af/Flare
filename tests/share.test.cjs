const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { QuickShare } = require('../desktop/share.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-share-'));
  const file = path.join(dir, 'sample.txt');
  await fs.writeFile(file, 'Fixture data, never a personal file.');
  const share = new QuickShare(
    () => {},
    () => ['127.0.0.1'],
  );
  t.after(async () => {
    await share.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { share, file, dir };
}
test('sharing is opt-in, token protected, read-only, and stops immediately', async (t) => {
  const { share, file } = await fixture(t);
  assert.equal(share.status().active, false);
  await assert.rejects(share.start('unapproved', '127.0.0.1'), /Choose/);
  const selected = await share.select(file);
  assert.equal(share.status().active, false);
  await assert.rejects(share.start(selected.id, '0.0.0.0'), /private/);
  const status = await share.start(selected.id, '127.0.0.1');
  assert.equal(status.expiresAt > Date.now() + 590000, true);
  assert.equal(new URL(status.url).pathname.length, 44);
  const response = await fetch(status.url);
  assert.match(response.headers.get('content-disposition'), /^attachment/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'Fixture data, never a personal file.');
  assert.equal((await fetch(new URL('/wrong', status.url))).status, 404);
  assert.equal((await fetch(status.url, { method: 'POST' })).status, 405);
  const foreignHost = await new Promise((resolve, reject) => {
    require('node:http')
      .get(status.url, { headers: { Host: 'attacker.invalid' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(foreignHost, 404);
  assert.equal((await fetch(status.url, { method: 'HEAD' })).status, 200);
  await assert.rejects(share.start(selected.id, '127.0.0.1'), /Stop/);
  await share.stop();
  assert.equal(share.status().active, false);
  await assert.rejects(fetch(status.url));
});
test('changed files and expired sessions cannot be downloaded', async (t) => {
  const { share, file } = await fixture(t);
  let selected = await share.select(file);
  await fs.writeFile(file, 'changed');
  await assert.rejects(share.start(selected.id, '127.0.0.1'), /changed/);
  selected = await share.select(file);
  let status = await share.start(selected.id, '127.0.0.1');
  await fs.writeFile(file, 'different private content');
  assert.equal((await fetch(status.url)).status, 410);
  await share.stop();
  selected = await share.select(file);
  status = await share.start(selected.id, '127.0.0.1');
  share.current.expiresAt = Date.now() - 1;
  assert.equal((await fetch(status.url)).status, 404);
});
test('directories and stale selections are rejected', async (t) => {
  const { share, file, dir } = await fixture(t);
  await assert.rejects(share.select(dir), /regular file/);
  const old = await share.select(file);
  await share.select(file);
  await assert.rejects(share.start(old.id, '127.0.0.1'), /Choose/);
});

test('stop cancels a share that is still being prepared', async (t) => {
  const { share, file } = await fixture(t);
  const selected = await share.select(file);
  const starting = share.start(selected.id, '127.0.0.1');
  const result = starting.then(
    () => 'started',
    () => 'cancelled',
  );
  await share.stop();
  assert.equal(await result, 'cancelled');
  assert.equal(share.status().active, false);
});
