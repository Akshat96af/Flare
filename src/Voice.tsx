import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, ArrowUp, LoaderCircle, RotateCcw } from 'lucide-react';
import { bridge } from './bridge';
import type { Settings } from './types';

export default function Voice({
  settings,
  onTranscript,
  onClose,
  stopSignal,
}: {
  settings: Settings;
  onTranscript: (text: string) => void;
  onClose: () => void;
  stopSignal: number;
}) {
  const [state, setState] = useState('preparing'),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [attempt, setAttempt] = useState(0);
  const bars = useRef<HTMLDivElement>(null),
    stop = useRef<() => void>(() => {}),
    cancel = useRef<() => void>(() => {}),
    seenSignal = useRef(stopSignal);
  useEffect(() => {
    setState('preparing');
    setError('');
    setText('');
    let active = true,
      stream: MediaStream | undefined,
      context: AudioContext | undefined,
      rec: MediaRecorder | undefined,
      frame = 0,
      timer = 0,
      stopping = false,
      mode = 'preparing',
      ready = false,
      recorded: Promise<void> | undefined;
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
          rec.onstop = () => resolve();
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
      stopping = true;
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
      if (!active) return;
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
    cancel.current = () => {
      active = false;
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
    stop.current = () => {
      if (stopping) return;
      stopping = true;
      if (mode === 'preparing' || !ready) return;
      setState('transcribing');
      stopRecording();
      if (mode === 'local') bridge.call('voice-stop').catch((e) => fail(e.message));
      else cloud();
    };
    const listening = () => {
      if (!active || ready) return;
      ready = true;
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
        const preferOnline = settings.ai.speechCloud && settings.ai.speechMode === 'online';
        const capability = preferOnline
          ? { available: false }
          : await bridge.call('voice-status').catch(() => ({ available: false }));
        if (!active) return;
        if (stopping) {
          fail('Stopped before the microphone was ready. Try again.');
          return;
        }
        mode = capability.available ? 'local' : 'cloud';
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
          },
        });
        if (!active) {
          await stopRecording();
          return;
        }
        context = new AudioContext();
        await context.resume();
        if (!active) {
          await stopRecording();
          return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const waveform = new Float32Array(analyser.fftSize);
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
        if (mode === 'cloud') listening();
        const draw = () => {
          if (!active || (stopping && ready)) return;
          analyser.getByteFrequencyData(data);
          analyser.getFloatTimeDomainData(waveform);
          let sum = 0;
          waveform.forEach((x) => (sum += x * x));
          if (ready && Math.sqrt(sum / waveform.length) > 0.008) {
            lastSound = Date.now();
            heard = true;
          }
          bars.current?.querySelectorAll<HTMLElement>('i').forEach((bar, i) => {
            bar.style.transform = `scaleY(${0.12 + (data[Math.floor((i * data.length) / 25)] / 255) * 1.8})`;
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
        if (mode === 'local') {
          const result = bridge.call('voice-start');
          if (stopping) {
            setState('transcribing');
            await stopRecording();
            bridge.call('voice-stop').catch(() => {});
          }
          try {
            const transcript = await result;
            if (!transcript?.trim())
              throw new Error(
                'Windows speech could not recognize a command. Try online voice in Intelligence settings.',
              );
            await finish(transcript);
          } catch (e) {
            if (!active) return;
            if (!settings.ai.speechCloud) {
              fail((e as Error).message);
              return;
            }
            mode = 'cloud';
            if (stopping || heard) await cloud();
            else listening();
          }
        } else if (stopping) await cloud();
      } catch (e) {
        fail((e as Error).message);
      }
    })();
    return () => {
      active = false;
      removeReady();
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
  }, [settings, attempt]);
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
          title="Cancel voice"
          onClick={() => {
            cancel.current();
            onClose();
          }}
        >
          <X size={17} />
        </button>
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
    </section>
  );
}
