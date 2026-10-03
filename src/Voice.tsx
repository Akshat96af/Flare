import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, ArrowUp, LoaderCircle } from 'lucide-react';
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
    [text, setText] = useState('');
  const bars = useRef<HTMLDivElement>(null),
    stop = useRef<() => void>(() => {}),
    cancel = useRef<() => void>(() => {}),
    seenSignal = useRef(stopSignal);
  useEffect(() => {
    let active = true,
      stream: MediaStream | undefined,
      context: AudioContext | undefined,
      rec: MediaRecorder | undefined,
      frame = 0,
      timer = 0,
      stopping = false,
      mode = 'preparing',
      recorded: Promise<void> | undefined;
    const chunks: Blob[] = [];
    let lastSound = 0,
      started = 0,
      heard = false;
    const stopRecording = () => {
      if (recorded) return recorded;
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
      if (active) {
        setError(message);
        setState('error');
      }
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
    const finish = async (value: string) => {
      await stopRecording();
      if (!active) return;
      if (value?.trim()) {
        setText(value.trim());
        setState('review');
      } else fail('No speech heard. Try again.');
    };
    const cloud = async () => {
      if (!active) return;
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
      if (mode === 'preparing') return;
      setState('transcribing');
      stopRecording();
      if (mode === 'local') bridge.call('voice-stop').catch((e) => fail(e.message));
      else cloud();
    };
    (async () => {
      try {
        const capability = await bridge.call('voice-status').catch(() => ({ available: false }));
        if (!active) return;
        mode = capability.available ? 'local' : 'cloud';
        if (mode === 'cloud' && !settings.ai.speechCloud) {
          fail(
            'Install English Windows speech, or enable online voice fallback in Intelligence settings.',
          );
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (!active) {
          await stopRecording();
          return;
        }
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        rec = new MediaRecorder(stream, { mimeType: mime });
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.start(250);
        started = lastSound = Date.now();
        setState('listening');
        const draw = () => {
          if (!active || stopping) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          data.forEach((x) => (sum += x));
          if (sum / data.length / 255 > 0.035) {
            lastSound = Date.now();
            heard = true;
          }
          bars.current?.querySelectorAll<HTMLElement>('i').forEach((bar, i) => {
            bar.style.transform = `scaleY(${0.12 + (data[Math.floor((i * data.length) / 25)] / 255) * 1.8})`;
          });
          if (
            settings.voiceMode === 'auto' &&
            ((heard && Date.now() - lastSound > 1600 && Date.now() - started > 2500) ||
              (!heard && Date.now() - started > 8000))
          ) {
            stop.current();
            return;
          }
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        timer = window.setTimeout(() => stop.current(), 25000);
        if (mode === 'local') {
          const result = bridge.call('voice-start');
          if (stopping) {
            setState('transcribing');
            await stopRecording();
            bridge.call('voice-stop').catch(() => {});
          }
          try {
            await finish(await result);
          } catch (e) {
            if (!active) return;
            if (!settings.ai.speechCloud) {
              fail((e as Error).message);
              return;
            }
            mode = 'cloud';
            if (stopping) await cloud();
            else setState('listening');
          }
        } else if (stopping) await cloud();
      } catch (e) {
        fail((e as Error).message);
      }
    })();
    return () => {
      active = false;
      stopRecording();
      bridge.call('voice-cancel').catch(() => {});
    };
  }, [settings]);
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
      <div className="voice-visual" aria-hidden="true">
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
    </section>
  );
}
