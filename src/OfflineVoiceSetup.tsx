import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Mic, X } from 'lucide-react';
import { bridge, desktop, fileSize } from './bridge';
import type { Settings } from './types';
type Info = {
  supported: boolean;
  models: { id: string; title: string; size: number; ready: boolean }[];
  downloading: boolean;
};
export default function OfflineVoiceSetup({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const [info, setInfo] = useState<Info | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    status: string;
    completed: number;
    total: number;
  } | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    if (desktop)
      bridge
        .call('offline-voice-info')
        .then((value) => {
          if (active) setInfo(value);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    const remove = bridge.on('offline-download', (value) => {
      if (active) setProgress(value);
    });
    return () => {
      active = false;
      remove();
    };
  }, []);
  const model = info?.models.find((model) => model.id === settings.whisperModel);
  const save = async (patch: Partial<Settings>) => {
    setError('');
    setBusy(true);
    try {
      onChange(await bridge.call('settings', patch));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="offline-voice-setup" aria-label="Offline voice setup">
      <div className="section-heading">
        <div className="heading-group">
          <Mic size={17} />
          <h3>On-device voice</h3>
        </div>
        <span className="muted small">English</span>
      </div>
      <div className="setting-row">
        <div>
          <label htmlFor="local-voice-engine">Local recognition</label>
        </div>
        <select
          id="local-voice-engine"
          value={settings.speechEngine}
          disabled={busy || !desktop}
          onChange={(event) =>
            save({ speechEngine: event.target.value as Settings['speechEngine'] })
          }
        >
          <option value="windows">Windows speech</option>
          <option value="whisper" disabled={!info?.supported}>
            Offline Whisper
          </option>
        </select>
      </div>
      {settings.speechEngine === 'whisper' && (
        <>
          <label className="field-label">
            Voice model
            <select
              aria-label="Offline voice model"
              value={settings.whisperModel}
              disabled={busy}
              onChange={(event) => {
                setConfirm(false);
                save({ whisperModel: event.target.value });
              }}
            >
              {info?.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.title} / {fileSize(model.size)}
                  {model.ready ? ' / installed' : ''}
                </option>
              ))}
            </select>
          </label>
          {model?.ready ? (
            <div className="connection-verified" role="status">
              <Check size={14} />
              Ready offline
            </div>
          ) : busy ? (
            <div className="download-status" role="status">
              <progress max={progress?.total || 1} value={progress?.completed || 0} />
              <small>{progress?.status || 'Preparing voice model'}</small>
              <button
                className="icon-button"
                title="Cancel voice setup"
                aria-label="Cancel voice setup"
                onClick={() => bridge.call('offline-voice-cancel')}
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <p className="muted small">
                {desktop && window.flare
                  ? 'Not installed / select Offline Whisper in Flare Setup.'
                  : 'Available in the desktop app.'}
              </p>
              {info && !model?.ready && (
                <button className="subtle" onClick={() => setConfirm(!confirm)}>
                  <Mic size={15} />
                  Set up voice
                </button>
              )}
              {confirm && (
                <div className="test-confirmation">
                  <p>
                    {fileSize(model?.size)} of engine and model data. Installation uses the bundled
                    model when available.
                  </p>
                  <button
                    className="primary"
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        setInfo(
                          await bridge.call('offline-voice-install', {
                            model: settings.whisperModel,
                            confirm: true,
                          }),
                        );
                        setConfirm(false);
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Check size={15} />
                    Confirm setup
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!info && desktop && !error && (
        <LoaderCircle size={16} className="spin" aria-label="Checking offline voice" />
      )}
    </section>
  );
}
