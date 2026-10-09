const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const AxeBuilder = require('@axe-core/playwright').default;

(async () => {
  const directory = path.resolve('Files/private/verification/voice-' + Date.now());
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
  const checks = [],
    errors = [];
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await instance.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('flare:call');
      global.voiceFixture = {
        starts: 0,
        status: 0,
        uploads: 0,
        aborted: 0,
        hold: false,
        resolve: null,
      };
      ipcMain.removeHandler('flare:call');
      ipcMain.handle('flare:call', async (event, method, data) => {
        const state = global.voiceFixture;
        if (method === 'voice-status') {
          state.status++;
          return { available: true };
        }
        if (method === 'voice-start') {
          state.starts++;
          return new Promise((resolve) => {
            state.resolve = resolve;
          });
        }
        if (method === 'voice-stop') {
          state.resolve?.('open Claude');
          state.resolve = null;
          return true;
        }
        if (method === 'voice-cancel') {
          state.resolve?.('');
          state.resolve = null;
        }
        return original(event, method, data);
      });
      global.fetch = async (url, options) => {
        const state = global.voiceFixture;
        if (options.method === 'GET')
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: 'models/gemini-3.6-flash',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-3.5-transcribe',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
          );
        state.uploads++;
        state.url = url;
        const body = JSON.parse(options.body);
        const audio = body.contents[0].parts.find((part) => part.inlineData).inlineData;
        state.mime = audio.mimeType;
        state.bytes = Buffer.from(audio.data, 'base64').length;
        if (state.hold)
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              'abort',
              () => {
                state.aborted++;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            ),
          );
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'open YouTube' }] } }] }),
        );
      };
    });
    await page.evaluate(() => {
      window.voiceTest = { tracks: [], defer: false, release: null, gain: 0.008 };
      // An oscillator feeds a MediaStream destination only, never speakers or a microphone.
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        await context.resume();
        const source = context.createOscillator(),
          destination = context.createMediaStreamDestination();
        const gain = context.createGain();
        gain.gain.value = window.voiceTest.gain;
        source.connect(gain);
        gain.connect(destination);
        source.start();
        const track = destination.stream.getAudioTracks()[0];
        window.voiceTest.tracks.push(track);
        const original = track.stop.bind(track);
        track.stop = () => {
          original();
          source.stop();
          context.close().catch(() => {});
        };
        if (window.voiceTest.defer)
          return new Promise((resolve) => {
            window.voiceTest.release = () => resolve(destination.stream);
          });
        return destination.stream;
      };
    });
    const voice = page.getByRole('button', { name: 'Voice command', exact: true });
    await voice.click();
    await expect.poll(() => instance.evaluate(() => global.voiceFixture.starts)).toBe(1);
    await expect(page.getByRole('heading', { name: 'Getting ready.' })).toBeVisible();
    await instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('flare:voice-ready', {}),
    );
    await page.getByRole('heading', { name: 'Listening.' }).waitFor();
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect(page.getByLabel('Voice transcript')).toHaveValue('open Claude');
    assert.equal(await instance.evaluate(() => global.voiceFixture.uploads), 0);
    checks.push(
      'Windows listening indicator waits for native readiness; local success uploads nothing',
    );
    await page.getByTitle('Cancel voice', { exact: true }).click();
    await page.evaluate(() => {
      window.voiceTest.defer = true;
    });
    await voice.click();
    await expect.poll(() => page.evaluate(() => !!window.voiceTest.release)).toBe(true);
    await page.getByTitle('Cancel voice', { exact: true }).click();
    await page.evaluate(() => {
      window.voiceTest.release();
      window.voiceTest.defer = false;
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.voiceTest.tracks.every((t) => t.readyState === 'ended')),
      )
      .toBe(true);
    checks.push('Cancellation during microphone preparation stops a stream that arrives late');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Hold your shortcut for 1 second.')).toBeVisible();
    await page.getByRole('button', { name: /^Intelligence/ }).click();
    await page.getByLabel('Use a model', { exact: true }).selectOption('gemini');
    await page.getByLabel('API key', { exact: true }).fill('fixture-key');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('1 models available', { exact: true }).waitFor();
    await page.getByLabel('Voice recognition', { exact: true }).selectOption('online');
    await expect(page.getByLabel('Speech model', { exact: true })).toHaveValue('');
    await page.getByLabel('Speech model', { exact: true }).selectOption('gemini-3.5-transcribe');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    const prefs = await page.evaluate(
      async () => (await window.flare.call('snapshot')).settings.ai,
    );
    assert.equal(prefs.model, 'gemini-3.6-flash');
    assert.equal(prefs.speechMode, 'online');
    await page.getByTitle('Close settings', { exact: true }).click();
    const before = await instance.evaluate(() => ({
      starts: global.voiceFixture.starts,
      status: global.voiceFixture.status,
    }));
    await voice.click();
    await page.getByRole('heading', { name: 'Listening.' }).waitFor();
    await expect
      .poll(() =>
        page
          .locator('.waveform i')
          .first()
          .evaluate((el) => el.style.transform),
      )
      .not.toBe('scaleY(0.12)');
    // Ensure at least one MediaRecorder chunk and a meter sample are present.
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect(page.getByLabel('Voice transcript')).toHaveValue('open YouTube');
    const state = await instance.evaluate(() => ({ ...global.voiceFixture, resolve: undefined }));
    assert.equal(state.starts, before.starts);
    assert.equal(state.status, before.status);
    assert.equal(state.uploads, 1);
    assert.ok(state.bytes > 100);
    assert.equal(state.mime, 'audio/webm');
    assert.match(state.url, /gemini-3.5-transcribe:generateContent$/);
    await page.screenshot({ path: path.join(directory, 'transcript-review.png') });
    const audit = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.equal(audit.violations.length, 0);
    checks.push(
      'Explicit online mode bypasses Windows, uses dedicated model, retains chat model, and reviews transcript',
    );
    await page.evaluate(() => {
      window.voiceTest.gain = 0;
    });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('heading', { name: 'Listening.' }).waitFor();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await page.getByText(/No microphone signal detected/).waitFor();
    assert.equal(await instance.evaluate(() => global.voiceFixture.uploads), 1);
    await expect(page.getByRole('button', { name: 'Voice settings' })).toBeVisible();
    await page.evaluate(() => {
      window.voiceTest.gain = 0.008;
    });
    checks.push(
      'Quiet synthetic input is captured; silence is not uploaded and recovery settings are reachable',
    );
    await instance.evaluate(() => {
      global.voiceFixture.hold = true;
    });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Listening.' }).waitFor();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect.poll(() => instance.evaluate(() => global.voiceFixture.uploads)).toBe(2);
    await page.keyboard.press('Escape');
    await expect.poll(() => instance.evaluate(() => global.voiceFixture.aborted)).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.voiceTest.tracks.every((t) => t.readyState === 'ended')),
      )
      .toBe(true);
    checks.push(
      'Retry works; Escape aborts pending online transcription and releases all audio tracks',
    );
    assert.deepEqual(errors, []);
    const report = {
      checks,
      errors,
      violations: audit.violations,
      realMicrophoneAccess: 0,
      paidRequests: 0,
    };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ directory, ...report }, null, 2));
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
