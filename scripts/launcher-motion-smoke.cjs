const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  const directory = path.resolve('Files/private/verification/launch-motion-' + Date.now());
  await fs.mkdir(directory, { recursive: true });
  const env = { ...process.env, FLARE_DATA_DIR: path.join(directory, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({
    executablePath: process.env.FLARE_SMOKE_EXE || require('electron'),
    args: process.env.FLARE_SMOKE_EXE ? ['--portable'] : ['.'],
    env,
    cwd: path.resolve('.'),
    timeout: 60000,
  });
  const traces = [],
    errors = [];
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await expect
      .poll(() =>
        instance.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Space')),
      )
      .toBe(true);
    await page.evaluate(() => {
      window.motionTraces = [];
      window.addEventListener('flare:shown', () => {
        const root = document.querySelector('.launcher');
        const trace = {
          launches: root.getAnimations().filter((a) => a.id === 'flare-launch').length,
          samples: [],
        };
        window.motionTraces.push(trace);
        const started = performance.now();
        const sample = (time) => {
          const style = getComputedStyle(root),
            matrix = new DOMMatrixReadOnly(style.transform);
          trace.samples.push({
            time,
            opacity: +style.opacity,
            y: matrix.m42,
            scale: matrix.m11,
            height: root.offsetHeight,
          });
          if (time - started < 450) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });
    const tap = () =>
      instance.evaluate(() => {
        const key = require('koffi')
          .load('user32.dll')
          .func('void __stdcall keybd_event(uint8 key,uint8 scan,uint32 flags,uintptr extra)');
        key(0x12, 0, 0, 0);
        key(0x20, 0, 0, 0);
        key(0x20, 0, 2, 0);
        key(0x12, 0, 2, 0);
      });
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await expect
        .poll(() =>
          instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
        )
        .toBe(false);
      const previous = await page.evaluate(() => window.motionTraces.length);
      await tap();
      await expect
        .poll(() =>
          instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
        )
        .toBe(true);
      await expect.poll(() => page.evaluate(() => window.motionTraces.length)).toBe(previous + 1);
      await expect(page.locator('.settings-panel')).toHaveCount(0);
      await expect(page.locator('.launcher')).toHaveAttribute('data-launch-motion', 'idle');
      await page.waitForTimeout(180);
      const trace = await page.evaluate(() => window.motionTraces.at(-1));
      assert.equal(trace.launches, 1);
      assert.ok(trace.samples.length >= 4);
      assert.equal(
        new Set(trace.samples.map((sample) => sample.height)).size,
        1,
        'Layout settles before the window is shown',
      );
      assert.ok(
        trace.samples.every((sample) => Math.abs(sample.scale - 1) < 0.0001),
        'Glass is not repeatedly rescaled',
      );
      for (let at = 1; at < trace.samples.length; at++) {
        assert.ok(
          trace.samples[at].opacity >= trace.samples[at - 1].opacity - 0.01,
          'Opacity never restarts or flashes',
        );
        assert.ok(
          trace.samples[at].y >= trace.samples[at - 1].y - 0.1,
          'Opening movement has no reversals',
        );
      }
      traces.push(trace);
    }
    await page.screenshot({ path: path.join(directory, 'settled.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Escape');
    await tap();
    await expect
      .poll(() =>
        instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      )
      .toBe(true);
    await expect(page.locator('.launcher')).toHaveAttribute('data-launch-motion', 'idle');
    assert.deepEqual(errors, []);
    const report = {
      checks: [
        'Three real Windows Alt+Space opens from hidden settings',
        'One monotonic launch animation, stable layout, no glass scaling',
        'Reduced motion remains immediate',
      ],
      traces,
      errors,
    };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ directory, checks: report.checks, errors }, null, 2));
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
