import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Mic } from 'lucide-react';
import { bridge, desktop } from './bridge';
import type { Settings } from './types';
type Info = { supported: boolean; models: { id: string; title: string; ready: boolean }[] };
export default function OfflineVoiceSetup({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const [info, setInfo] = useState<Info | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (desktop) bridge.call('offline-voice-info').then((value) => { if (active) setInfo(value); }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const installed = info?.models.some((model) => model.ready);
  const model = info?.models.find((model) => model.id === settings.whisperModel);
  const save = async (patch: Partial<Settings>) => {
    setError(''); setBusy(true);
    try { onChange(await bridge.call('settings', patch)); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <section className="offline-voice-setup" aria-label="Offline voice setup">
    <div className="section-heading"><div className="heading-group"><Mic size={17} /><h3>On-device voice</h3></div><span className="muted small">English</span></div>
    <div className="setting-row"><div><label htmlFor="local-voice-engine">Local recognition</label></div><select id="local-voice-engine" value={settings.speechEngine} disabled={busy || !desktop} onChange={(event) => save({ speechEngine: event.target.value as Settings['speechEngine'] })}><option value="windows">Windows speech</option><option value="whisper" disabled={!info?.supported || !installed}>Offline Whisper{info && !installed ? ' / not installed' : ''}</option></select></div>
    {settings.speechEngine === 'whisper' && <>
      <label className="field-label">Voice model<select aria-label="Offline voice model" value={settings.whisperModel} disabled={busy || !info} onChange={(event) => save({ whisperModel: event.target.value })}>{info?.models.map((model) => <option key={model.id} value={model.id} disabled={!model.ready}>{model.title}{model.ready ? '' : ' / not installed'}</option>)}</select></label>
      {model?.ready && <div className="connection-verified" role="status"><Check size={14} />Ready offline</div>}
    </>}
    {info && !installed && <p className="muted small">Offline Whisper not installed / available in Flare Setup.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!info && desktop && !error && <LoaderCircle size={16} className="spin" aria-label="Checking offline voice" />}
  </section>;
}
