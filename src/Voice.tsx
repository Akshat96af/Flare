import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, ArrowUp, LoaderCircle, RotateCcw, Settings2 } from 'lucide-react';
import { bridge } from './bridge';
import type { Settings } from './types';
import { recordingWav } from './audio';

export default function Voice({
  settings,
  onTranscript,
  onClose,
  stopSignal,
  onSettings,
}: {
  settings: Settings;
  onTranscript: (text: string) => void;
  onClose: () => void;
  stopSignal: number;
  onSettings: () => void;
}) {
  const [state, setState] = useState('preparing'),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [attempt, setAttempt] = useState(0),
    [device, setDevice] = useState(() => localStorage.getItem('flare.microphone') || 'default'),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [signal, setSignal] = useState(''),
    [engine, setEngine] = useState('');
  const [recording, setRecording] = useState(''), [level, setLevel] = useState(0);
  const bars = useRef<HTMLDivElement>(null),
    stop = useRef<() => void>(() => {}),
    cancel = useRef<() => void>(() => {}),
    seenSignal = useRef(stopSignal);
  useEffect(() => {
    setState('preparing');
    setError('');
    setText('');
    setSignal('');
    setRecording(''); setLevel(0);
    let recordingUrl = '', lastLevelUpdate = 0;
    let active = true,
      stream: MediaStream | undefined,
      context: AudioContext | undefined,
      rec: MediaRecorder | undefined,
      frame = 0,
      timer = 0,
      stopping = false,
      mode = 'preparing',
      ready = false,
      failed = false,
      recorded: Promise<void> | undefined;
    let uploading = false,
      signalState = '';
    const preparationTimer = window.setTimeout(
      () => fail('The microphone took too long to start. Check your input device and try again.'),
      15000,
    );
    const chunks: Blob[] = [];
    let lastSound = 0,
      started = 0,
      heard = false;
    const stopRecording = () => {
      if (recorded) {
        stream?.getTracks().forEach((t) => t.stop());
        context?.close().catch(() => {});
        return recorded;
      }
      recorded = new Promise<void>((resolve) => {
        if (rec?.state === 'recording') {
          rec.onstop = () => {
            if (active && chunks.length) {
              recordingUrl = URL.createObjectURL(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }));
              setRecording(recordingUrl);
            }
            resolve();
          };
          rec.stop();
        } else resolve();
      });
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      context?.close().catch(() => {});
      return recorded;
    };
    const fail = (message: string) => {
      if (!active) return;
      clearTimeout(preparationTimer);
      stopping = true;
      failed = true;
      if (active) {
        setError(message);
        setState('error');
      }
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
    const finish = async (value: string) => {
      stopping = true;
      await stopRecording();
      if (!active) return;
      if (value?.trim()) {
        setText(value.trim());
        setState('review');
      } else fail('No speech heard. Try again.');
    };
    const cloud = async () => {
      if (!active || uploading) return;
      uploading = true;
      stopping = true;
      if (!heard) {
        fail('No microphone signal detected. Check the Windows input device and try again.');
        return;
      }
      setState('transcribing');
      await stopRecording();
      if (!active) return;
      try {
        const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }),
          bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await finish(await bridge.call('voice-transcribe', { bytes, mime: blob.type }));
      } catch (e) {
        fail((e as Error).message);
      }
    };
    const local = async () => {
      if (!active || uploading) return;
      uploading = true;
      if (!heard) {
        fail('No microphone signal detected. Choose your microphone and try again.');
        return;
      }
      setState('transcribing');
      await stopRecording();
      try {
        const bytes = await recordingWav(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }));
        if (!active) return;
        const transcript = await bridge.call('voice-recorded', { bytes });
        if (!active) return;
        if (!transcript?.trim())
          throw new Error(
            'No clear speech detected. Listen to the recording or choose Offline Whisper in Voice settings.',
          );
        await finish(transcript);
      } catch (error) {
        if (!active) return;
        if (settings.speechEngine !== 'whisper' && settings.ai.speechCloud) {
          uploading = false;
          await cloud();
        } else fail((error as Error).message);
      }
    };
    cancel.current = () => {
      active = false;
      clearTimeout(preparationTimer);
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
    stop.current = () => {
      if (stopping) return;
      stopping = true;
      if (mode === 'preparing' || !ready) return;
      setState('transcribing');
      stopRecording();
      if (mode === 'local') local();
      else cloud();
    };
    const listening = () => {
      if (!active || ready || failed) return;
      ready = true;
      clearTimeout(preparationTimer);
      started = lastSound = Date.now();
      setState('listening');
      timer = window.setTimeout(() => stop.current(), 25000);
      if (stopping) {
        stopping = false;
        stop.current();
      }
    };
    const removeReady = bridge.on('voice-ready', () => {
      if (mode === 'local') listening();
    });
    (async () => {
      try {
        const preferOnline = settings.speechEngine !== 'whisper' && settings.ai.speechCloud && settings.ai.speechMode === 'online';
        const capability = preferOnline
          ? { available: false }
          : await bridge.call('voice-status').catch(() => ({ available: false }));
        if (!active) return;
        if (settings.speechEngine === 'whisper' && !capability.available) {
          fail('Offline Whisper is not installed. Select it in Flare Setup, or use Windows speech.');
          return;
        }
        if (stopping) {
          fail('Stopped before the microphone was ready. Try again.');
          return;
        }
        mode = capability.available ? 'local' : 'cloud';
        setEngine(
          mode === 'local'
            ? settings.speechEngine === 'whisper' ? 'Offline Whisper' : 'Windows speech'
            : `${settings.ai.provider === 'gemini' ? 'Gemini' : settings.ai.provider === 'groq' ? 'Whisper' : 'OpenAI'} transcription`,
        );
        if (mode === 'cloud' && !settings.ai.speechCloud) {
          fail('Install English Windows speech, or choose online voice in Intelligence settings.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            ...(device !== 'default' ? { deviceId: { exact: device } } : {}),
          },
        });
        if (!active || failed) {
          await stopRecording();
          return;
        }
        if (stopping) {
          fail('Stopped before the microphone was ready. Try again.');
          await stopRecording();
          return;
        }
        navigator.mediaDevices
          .enumerateDevices()
          .then((list) => {
            if (active)
              setDevices(
                list.filter(
                  (item) =>
                    item.kind === 'audioinput' &&
                    item.deviceId !== 'default' &&
                    item.deviceId !== 'communications',
                ),
              );
          })
          .catch(() => {});
        context = new AudioContext();
        await context.resume();
        if (!active || failed) {
          await stopRecording();
          return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const waveform = new Float32Array(analyser.fftSize);
        const meterBars = Array.from(bars.current?.querySelectorAll<HTMLElement>('i') || []);
        const levels = meterBars.map(() => 0.12);
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
        rec.onerror = () =>
          fail('The microphone recording failed. Check your input device and try again.');
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.start(250);
        listening();
        const draw = () => {
          if (!active || (stopping && ready)) return;
          analyser.getFloatTimeDomainData(waveform);
          let sum = 0;
          waveform.forEach((x) => (sum += x * x));
          const rms = Math.sqrt(sum / waveform.length);
          if (Date.now() - lastLevelUpdate > 150) {
            setLevel(Math.min(1, rms * 8)); lastLevelUpdate = Date.now();
          }
          if (ready && rms > 0.003) {
            lastSound = Date.now();
            heard = true;
          }
          const nextSignal =
            rms > 0.65
              ? 'Input is very loud'
              : heard
                ? 'Microphone signal detected'
                : ready && Date.now() - started > 4000
                  ? 'No input yet'
                  : '';
          if (nextSignal !== signalState) {
            signalState = nextSignal;
            setSignal(nextSignal);
          }
          meterBars.forEach((bar, i) => {
            const start = Math.floor((i * waveform.length) / meterBars.length);
            const end = Math.floor(((i + 1) * waveform.length) / meterBars.length);
            let energy = 0;
            for (let sample = start; sample < end; sample++) energy += waveform[sample] ** 2;
            const target = 0.12 + Math.min(1.1, Math.sqrt(energy / (end - start)) * 40);
            levels[i] += (target - levels[i]) * 0.26;
            bar.style.transform = `scaleY(${reducedMotion.matches ? 0.12 : levels[i]})`;
          });
          if (
            ready &&
            settings.voiceMode === 'auto' &&
            ((heard && Date.now() - lastSound > 2000 && Date.now() - started > 2500) ||
              (!heard && Date.now() - started > 10000))
          ) {
            stop.current();
            return;
          }
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        if (stopping) {
          if (mode === 'local') await local();
          else await cloud();
        }
      } catch (e) {
        const problem = e as Error;
        fail(
          problem.name === 'NotAllowedError'
            ? 'Microphone access is blocked. Allow Flare in Windows microphone privacy settings.'
            : problem.name === 'NotFoundError' || problem.name === 'OverconstrainedError'
              ? 'This microphone is unavailable. Choose another input device.'
              : problem.name === 'NotReadableError'
                ? 'The microphone is busy or unavailable. Close other recording apps and try again.'
                : problem.message,
        );
      }
    })();
    return () => {
      active = false;
      clearTimeout(preparationTimer);
      removeReady();
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
  }, [settings, attempt, device]);
  useEffect(() => {
    if (stopSignal !== seenSignal.current) {
      seenSignal.current = stopSignal;
      stop.current();
    }
  }, [stopSignal]);
  const processing = ['preparing', 'transcribing'].includes(state);
  return (
    <section className="voice-panel" aria-label="Voice command">
      <div className="section-heading">
        <span className="eyebrow">VOICE</span>
        <button
          className="icon-button"
          title="Voice settings"
          aria-label="Voice settings"
          onClick={() => {
            cancel.current();
            onSettings();
          }}
        >
          <Settings2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Cancel voice"
          onClick={() => {
            cancel.current();
            onClose();
          }}
        >
          <X size={17} />
        </button>
      </div>
      <div className="voice-source">
        <span>{engine}</span>
        {
          <select
            aria-label="Microphone"
            value={device}
            disabled={state === 'transcribing'}
            onChange={(event) => {
              localStorage.setItem('flare.microphone', event.target.value);
              setDevice(event.target.value);
            }}
          >
            <option value="default">Default microphone</option>
            {devices.map((item, i) => (
              <option key={item.deviceId} value={item.deviceId}>
                {item.label || `Microphone ${i + 1}`}
              </option>
            ))}
            {device !== 'default' && !devices.some((item) => item.deviceId === device) && (
              <option value={device}>Selected microphone unavailable</option>
            )}
          </select>
        }
      </div>
      <div className="voice-visual" data-state={state} aria-hidden="true">
        <div className="voice-core">
          {processing ? <LoaderCircle className="spin" size={24} /> : <Mic size={24} />}
        </div>
        <div ref={bars} className={'waveform ' + (processing ? 'processing' : '')}>
          {Array.from({ length: 25 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
      <h2>
        {state === 'preparing'
          ? 'Getting ready.'
          : state === 'listening'
            ? 'Listening.'
            : state === 'transcribing'
              ? 'Finding your words.'
              : state === 'review'
                ? 'You said...'
                : "Let's try that again."}
      </h2>
      {state === 'listening' && (
        <div className="voice-input-level"><meter aria-label="Microphone input level" min={0} max={1} value={level} /><p className="voice-signal" role="status">{signal || 'Waiting for speech'}</p></div>
      )}
      {state === 'review' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onTranscript(text);
          }}
        >
          <input
            className="transcript"
            aria-label="Voice transcript"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button className="primary" type="submit" disabled={!text.trim()}>
            Use command <ArrowUp size={15} />
          </button>
        </form>
      ) : (
        <p className="muted">
          {error ||
            (settings.voiceMode === 'push'
              ? 'Release your shortcut when finished.'
              : 'Speak a command. Stop whenever you like.')}
        </p>
      )}
      {state === 'listening' && (
        <button className="subtle" onClick={() => stop.current()}>
          <Square size={12} /> Stop listening
        </button>
      )}
      {['error', 'review'].includes(state) && (
        <button className="subtle" onClick={() => setAttempt((value) => value + 1)}>
          <RotateCcw size={14} /> Try again
        </button>
      )}
      {state === 'error' && (
        <button
          className="subtle"
          onClick={() => {
            cancel.current();
            onSettings();
          }}
        >
          <Settings2 size={14} /> Voice settings
        </button>
      )}
      {recording && ['error', 'review'].includes(state) && <audio className="voice-recording" aria-label="Listen to your recording" controls preload="metadata" src={recording} />}
    </section>
  );
}
