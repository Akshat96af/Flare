import { useState, useEffect } from 'react';
import {
  X,
  Sun,
  Moon,
  Monitor,
  ChevronRight,
  ArrowLeft,
  Check,
  Plus,
  Folder,
  Trash2,
  LoaderCircle,
  Shield,
  Code2,
} from 'lucide-react';
import { bridge, desktop, basename } from './bridge';
import type { Settings as Prefs, IndexStatus } from './types';
function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-on={checked}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
export default function Settings({
  value,
  index,
  onChange,
  onClose,
}: {
  value: Prefs;
  index: IndexStatus;
  onChange: (v: Prefs) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState('general'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [shortcut, setShortcut] = useState(value.shortcut);
  const [provider, setProvider] = useState(value.ai.provider),
    [key, setKey] = useState(''),
    [model, setModel] = useState(value.ai.model),
    [models, setModels] = useState<string[]>([]),
    [speech, setSpeech] = useState(value.ai.speechCloud),
    [connected, setConnected] = useState('');
  const [local, setLocal] = useState<any>(null),
    [download, setDownload] = useState<any>(null),
    [downloading, setDownloading] = useState(false),
    [approveDownload, setApproveDownload] = useState(false);
  useEffect(() => {
    if (provider === 'local')
      bridge
        .call('local-info')
        .then(setLocal)
        .catch(() => {});
  }, [provider]);
  useEffect(() => bridge.on('model-download', setDownload), []);
  const run = async (task: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: any) => run(async () => onChange(await bridge.call('settings', patch)));
  const checkModels = () =>
    run(async () => {
      const list = await bridge.call('models', { provider, key });
      setModels(list);
      setModel(list.includes(model) ? model : list[0] || '');
      setConnected(list.length ? 'Connection ready' : 'No installed models found.');
    });
  const addFolder = () =>
    run(async () => {
      const [folder] = await bridge.call('pick', { kind: 'folder' });
      if (folder)
        onChange(
          await bridge.call('settings', {
            roots: [...new Set([...value.roots, folder])],
            setup: true,
          }),
        );
    });
  return (
    <section className="settings-panel">
      <div className="section-heading">
        <div className="heading-group">
          {page !== 'general' && (
            <button className="icon-button" title="Back" onClick={() => setPage('general')}>
              <ArrowLeft size={17} />
            </button>
          )}
          <h2>
            {page === 'general'
              ? 'Settings'
              : page === 'search'
                ? 'Search locations'
                : page === 'ai'
                  ? 'Intelligence'
                  : 'Safety & recovery'}
          </h2>
        </div>
        <button className="icon-button" title="Close settings" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {page === 'general' && (
        <>
          <div className="setting-row">
            <div>
              <label>Appearance</label>
              <span>Make yourself at home.</span>
            </div>
            <div className="segmented">
              {[
                ['system', Monitor],
                ['light', Sun],
                ['dark', Moon],
              ].map(([theme, Icon]: any) => (
                <button
                  key={theme}
                  data-active={value.theme === theme}
                  title={theme}
                  aria-label={theme + ' theme'}
                  onClick={() => save({ theme })}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <label>Open Flare</label>
              <span>Your shortcut, anywhere.</span>
            </div>
            <input
              className="shortcut-input"
              aria-label="Global shortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              onBlur={() => {
                if (shortcut !== value.shortcut) save({ shortcut });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </div>
          <div className="setting-row">
            <div>
              <label>Voice mode</label>
              <span>Hold your shortcut for 3 seconds.</span>
            </div>
            <select
              aria-label="Voice mode"
              value={value.voiceMode}
              onChange={(e) => save({ voiceMode: e.target.value })}
            >
              <option value="auto">Stop after silence</option>
              <option value="push">Push to talk</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <label>Launch at sign-in</label>
              <span>{desktop ? 'Ready when you are.' : 'Available in the installed app.'}</span>
            </div>
            <Toggle
              label="Launch at sign-in"
              checked={value.startup}
              disabled={!desktop}
              onChange={() => save({ startup: !value.startup })}
            />
          </div>
          {[
            ['search', 'Search locations', `${value.roots.length} locations`],
            ['ai', 'Intelligence', value.ai.provider === 'off' ? 'Off' : value.ai.provider],
            ['safety', 'Safety & recovery', 'Your files, your control'],
          ].map(([id, title, detail]) => (
            <button key={id} className="setting-link" onClick={() => setPage(id)}>
              <span>{title}</span>
              <span className="link-detail">
                {detail}
                <ChevronRight size={16} />
              </span>
            </button>
          ))}
          <div className="setting-row last">
            <div>
              <label>Developer mode</label>
              <span>Diagnostics and advanced options.</span>
            </div>
            <Toggle
              label="Developer mode"
              checked={value.developer}
              onChange={() => save({ developer: !value.developer })}
            />
          </div>
          {value.developer && (
            <div className="diagnostic">
              <Code2 size={15} />
              <span>
                Index: {index.state} / {index.count} files
              </span>
              <button
                className="text-button"
                onClick={() => run(() => bridge.call('index', { action: 'resume' }))}
              >
                Rebuild
              </button>
            </div>
          )}
        </>
      )}
      {page === 'search' && (
        <>
          <p className="panel-copy">
            Choose what Flare can find. Everything stays on this computer.
          </p>
          <div className="index-status">
            <span className={'status-dot ' + (index.state === 'indexing' ? 'active' : '')} />
            <span>
              {index.state === 'indexing'
                ? `Indexing ${index.count.toLocaleString()} files...`
                : index.state === 'ready'
                  ? `${index.count.toLocaleString()} files indexed`
                  : index.state === 'error'
                    ? 'Index needs attention'
                    : 'Ready to index'}
            </span>
            <button
              className="text-button"
              onClick={() =>
                run(() =>
                  bridge.call('index', { action: index.state === 'indexing' ? 'pause' : 'resume' }),
                )
              }
            >
              {index.state === 'indexing' ? 'Pause' : 'Resume'}
            </button>
          </div>
          <div className="location-list">
            {value.roots.map((root) => (
              <div className="location" key={root}>
                <Folder size={17} />
                <span title={root}>{root}</span>
                <button
                  className="icon-button"
                  title={'Remove ' + root}
                  onClick={() => save({ roots: value.roots.filter((x) => x !== root) })}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button className="subtle" onClick={addFolder}>
              <Plus size={16} /> Add folder
            </button>
            <button
              className="subtle"
              onClick={() =>
                run(async () => {
                  const drives = await bridge.call('drives');
                  onChange(
                    await bridge.call('settings', {
                      roots: drives.map((x: any) => x.path),
                      setup: true,
                    }),
                  );
                })
              }
            >
              Use connected drives
            </button>
          </div>
          <div className="setting-row">
            <div>
              <label>Search inside documents</label>
              <span>Text, PDFs, Office documents and code.</span>
            </div>
            <Toggle
              label="Search document contents"
              checked={value.content}
              onChange={() => save({ content: !value.content })}
            />
          </div>
          <div className="setting-row">
            <div>
              <label>Clipboard history</label>
              <span>Up to 50 text items, for up to 7 days.</span>
            </div>
            <Toggle
              label="Clipboard history"
              checked={value.clipboard}
              onChange={() => save({ clipboard: !value.clipboard })}
            />
          </div>
          {value.clipboard && (
            <button
              className="text-button"
              onClick={() => run(() => bridge.call('clipboard-clear'))}
            >
              <Trash2 size={13} /> Clear clipboard history
            </button>
          )}
          <details className="exclusions">
            <summary>Excluded locations</summary>
            <label className="field-label">
              Names and paths
              <textarea
                value={value.exclusions.join('\n')}
                aria-label="Excluded paths"
                onChange={(e) => onChange({ ...value, exclusions: e.target.value.split('\n') })}
                onBlur={() => save({ exclusions: value.exclusions.filter((x) => x.trim()) })}
              />
            </label>
          </details>
        </>
      )}
      {page === 'ai' && (
        <>
          <p className="panel-copy">
            Add intelligence when you need it. Basic commands work without AI.
          </p>
          <label className="field-label">
            Use a model
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModels([]);
                setModel('');
                setConnected('');
              }}
            >
              <option value="off">Keep AI off</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="local">On this computer (Ollama)</option>
            </select>
          </label>
          {provider !== 'off' && (
            <>
              {provider !== 'local' ? (
                <label className="field-label">
                  API key
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    placeholder="Enter a key, or keep your saved key"
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <small>Encrypted on this computer. API usage is billed by your provider.</small>
                </label>
              ) : (
                <div className="local-setup">
                  <button
                    className="subtle"
                    onClick={() => run(() => bridge.call('local-install'))}
                  >
                    Get Ollama <ChevronRight size={15} />
                  </button>
                  <p className="panel-copy">
                    Install and open Ollama. Your models and file content stay on this computer.
                  </p>
                  {local?.catalogue.map((item: any) => (
                    <div key={item.id} className="local-model">
                      <div>
                        <h3>{item.title}</h3>
                        <small>
                          About 1 GB download / 2 GB free storage / 4 GB RAM recommended
                        </small>
                        {local.memory < item.ram && (
                          <p className="inline-error">This computer may have too little memory.</p>
                        )}
                      </div>
                      {!approveDownload && !downloading ? (
                        <button className="subtle" onClick={() => setApproveDownload(true)}>
                          Download
                        </button>
                      ) : downloading ? (
                        <button
                          className="icon-button"
                          title="Cancel download"
                          onClick={() => bridge.call('local-cancel')}
                        >
                          <X size={16} />
                        </button>
                      ) : (
                        <button
                          className="primary"
                          onClick={async () => {
                            setDownloading(true);
                            setError('');
                            try {
                              await bridge.call('local-pull', { model: item.id });
                              await checkModels();
                              setModel(item.id);
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setDownloading(false);
                              setApproveDownload(false);
                            }
                          }}
                        >
                          Confirm download
                        </button>
                      )}
                    </div>
                  ))}
                  {downloading && (
                    <div className="download-status" role="status">
                      <progress max={download?.total || 1} value={download?.completed || 0} />
                      <small>{download?.status || 'Connecting...'}</small>
                    </div>
                  )}
                  {approveDownload && (
                    <p className="muted small">
                      Ollama downloads the model to its own storage. Canceling may leave reusable
                      download chunks.
                    </p>
                  )}
                </div>
              )}
              <div className="button-row">
                <button className="subtle" disabled={busy} onClick={checkModels}>
                  {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Check
                  connection
                </button>
                <span className="muted">{connected}</span>
              </div>
              <label className="field-label">
                Model
                {models.length ? (
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Connect to choose an available model"
                  />
                )}
              </label>
              <div className="setting-row">
                <div>
                  <label>Online voice fallback</label>
                  <span>Send audio when local speech is unavailable.</span>
                </div>
                <Toggle
                  label="Online voice fallback"
                  checked={speech}
                  disabled={!['gemini', 'openai'].includes(provider)}
                  onChange={() => setSpeech(!speech)}
                />
              </div>
            </>
          )}
          <button
            className="primary"
            disabled={busy || (provider !== 'off' && !model)}
            onClick={() =>
              run(async () => {
                onChange(
                  await bridge.call('ai-save', { provider, model, key, speechCloud: speech }),
                );
                setKey('');
                setConnected('Saved');
              })
            }
          >
            Save connection <Check size={15} />
          </button>
        </>
      )}
      {page === 'safety' && (
        <>
          <div className="safety-note">
            <Shield size={22} />
            <p>
              File changes have a preview and recovery history. Originals are kept when converting.
            </p>
          </div>
          <label className="field-label">
            Trust level
            <select value={value.trust} onChange={(e) => save({ trust: e.target.value })}>
              <option value="cautious">Cautious - preview all changes</option>
              <option value="balanced">Balanced - allow new conversion outputs</option>
              <option value="custom">Custom - confirm file changes</option>
            </select>
          </label>
          {value.trust === 'custom' && (
            <div className="setting-row">
              <div>
                <label>Preview conversion outputs</label>
                <span>Moves and cleanup are always reviewed.</span>
              </div>
              <Toggle
                label="Preview conversion outputs"
                checked={value.confirmConversions}
                onChange={() => save({ confirmConversions: !value.confirmConversions })}
              />
            </div>
          )}
          <p className="panel-copy">
            Moves and cleanup always need approval. Recovery copies stay here until you restore
            them. Flare never permanently deletes cleanup candidates.
          </p>
          <div className="setting-row">
            <div>
              <label>Recovery history</label>
              <span>Review changes from the history button.</span>
            </div>
            <span className="local-label">LOCAL</span>
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
