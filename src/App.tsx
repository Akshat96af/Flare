import { useEffect, useRef, useState } from 'react';
import {
  Search,
  Mic,
  Settings2,
  History,
  Wand2,
  Zap,
  ArrowUpRight,
  ArrowRight,
  CornerDownLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Image,
  AppWindow,
  Globe,
  Clipboard,
  SlidersHorizontal,
  Calculator,
  Undo2,
  Check,
  LoaderCircle,
  X,
  Folder,
  ShieldCheck,
  Sparkles,
  Eye,
} from 'lucide-react';
import { bridge, desktop, basename, fileSize } from './bridge';
import type { Result, Settings as Prefs, IndexStatus, Operation } from './types';
import Settings from './Settings';
import Tools, { Plan } from './Tools';
import Voice from './Voice';

const icons: Record<string, any> = {
  app: AppWindow,
  file: FileText,
  folder: Folder,
  web: Globe,
  bookmark: Globe,
  clipboard: Clipboard,
  setting: SlidersHorizontal,
  command: Zap,
};
export default function App() {
  const [settings, setSettings] = useState<Prefs | null>(null),
    [index, setIndex] = useState<IndexStatus>({ state: 'idle', count: 0, current: '' }),
    [dark, setDark] = useState(true),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<Result[]>([]),
    [selected, setSelected] = useState(0),
    [kind, setKind] = useState('all'),
    [view, setView] = useState('search'),
    [tool, setTool] = useState(''),
    [preview, setPreview] = useState<any>(null),
    [metadata, setMetadata] = useState(false),
    [hold, setHold] = useState(0),
    [stopSignal, setStopSignal] = useState(0),
    [history, setHistory] = useState<Operation[]>([]),
    [plan, setPlan] = useState<Operation | null>(null),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [shortcutError, setShortcutError] = useState('');
  const input = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLDivElement>(null),
    sequence = useRef(0),
    viewRef = useRef(view),
    busyRef = useRef(busy);
  viewRef.current = view;
  busyRef.current = busy;
  useEffect(() => {
    bridge
      .call('snapshot')
      .then((data) => {
        setSettings(data.settings);
        setIndex(data.index);
        setDark(data.dark);
        setShortcutError(data.shortcutError || '');
        if (data.contentHeight)
          document.documentElement.style.setProperty('--content-height', data.contentHeight + 'px');
      })
      .catch((e) => setError(e.message));
    document.documentElement.dataset.environment = desktop ? 'desktop' : 'browser';
    const disposers = [
      bridge.on('activation', (data) => {
        if (data.contentHeight)
          document.documentElement.style.setProperty('--content-height', data.contentHeight + 'px');
        if (!busyRef.current) {
          setView(data.mode === 'settings' ? 'settings' : 'search');
          setQuery('');
          setPreview(null);
          setResults([]);
          setError('');
        }
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
          panel.current?.animate(
            [
              { opacity: 0, transform: 'translateY(-8px) scale(.985)' },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ],
            { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' },
          );
        input.current?.focus();
      }),
      bridge.on('hold', (data) => setHold(data.progress)),
      bridge.on('voice', (data) => {
        if (data.action === 'start') setView('voice');
        else setStopSignal((x) => x + 1);
      }),
      bridge.on('index', setIndex),
      bridge.on('theme', (data) => setDark(data.dark)),
      bridge.on('operation', (data) =>
        setPlan((current) => (current?.id === data.id ? data : current)),
      ),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, []);
  useEffect(() => {
    const isDark = settings?.theme === 'dark' || (settings?.theme === 'system' && dark);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [settings, dark]);
  useEffect(() => {
    if (!panel.current) return;
    const observer = new ResizeObserver((entries) => {
      const height = Math.ceil(entries[0].contentRect.height) + 74;
      bridge.call('resize', { height }).catch(() => {});
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (view === 'search') requestAnimationFrame(() => input.current?.focus());
  }, [view]);
  useEffect(() => {
    document.getElementById('result-' + selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  useEffect(() => {
    const id = ++sequence.current;
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setError('');
    setPreview(null);
    const timer = setTimeout(() => {
      bridge
        .call('search', { query, kind })
        .then((data) => {
          if (sequence.current === id) {
            setResults(data);
            setSelected(0);
            setSearching(false);
          }
        })
        .catch((e) => {
          if (sequence.current === id) {
            setError(e.message);
            setSearching(false);
          }
        });
    }, 80);
    return () => clearTimeout(timer);
  }, [
    query,
    kind,
    settings?.roots,
    settings?.content,
    settings?.clipboard,
    index.state === 'ready',
    index.state === 'ready' ? index.count : 0,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const act = async (task: () => Promise<any>) => {
    setError('');
    try {
      return await task();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const handleIntent = (intent: any) => {
    if (intent?.kind === 'tool') {
      setTool(intent.tool);
      setView('tools');
    } else if (intent?.kind === 'search') {
      setView('search');
      setQuery(intent.query);
    } else if (intent) {
      act(async () => {
        const value = await bridge.call('open', { intent });
        setNotice(value.message || '');
      });
    }
  };
  const open = (item: Result) =>
    act(async () => {
      const result = await bridge.call('open', { id: item.id });
      if (result.intent) handleIntent(result.intent);
      if (result.message) setNotice(result.message);
    });
  const showPreview = (item: Result) =>
    act(async () => {
      setBusy(true);
      try {
        setPreview(await bridge.call('preview', { id: item.id }));
        setMetadata(false);
      } finally {
        setBusy(false);
      }
    });
  const showHistory = () =>
    act(async () => {
      setHistory(await bridge.call('history'));
      setView('history');
    });
  const runPlan = (selection?: number[], value = plan) =>
    act(async () => {
      if (!value) return;
      setBusy(true);
      try {
        const result = await bridge.call('execute', { id: value.id, selection });
        setPlan(result);
        setHistory(await bridge.call('history'));
        setView('history');
        setNotice(
          result.status === 'done'
            ? 'Changes complete. Undo is available.'
            : result.status === 'partial'
              ? 'Some files could not be processed. Review history.'
              : 'Operation stopped.',
        );
      } finally {
        setBusy(false);
      }
    });
  const autoConvert =
    settings?.trust === 'balanced' ||
    (settings?.trust === 'custom' && !settings.confirmConversions);
  const undo = (id?: string) =>
    act(async () => {
      setBusy(true);
      try {
        const result = await bridge.call('undo', { id });
        setHistory(await bridge.call('history'));
        setNotice(
          result.status === 'undone'
            ? 'Changes undone.'
            : 'Some files could not be restored. Review conflicts.',
        );
      } finally {
        setBusy(false);
      }
    });
  const aiSearch = () =>
    act(async () => {
      setBusy(true);
      try {
        handleIntent(await bridge.call('ai-plan', { query }));
      } finally {
        setBusy(false);
      }
    });
  const reset = () => {
    setView('search');
    setPreview(null);
    setPlan(null);
    setError('');
  };
  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (busy && view === 'plan') return;
      if (view === 'voice') {
        bridge.call('voice-cancel');
        reset();
      } else if (view !== 'search' || preview) {
        reset();
      } else if (query) {
        setQuery('');
      } else bridge.call('hide');
    }
    if (view !== 'search') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !query) {
      e.preventDefault();
      undo();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((x) => Math.min(results.length - 1, x + 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((x) => Math.max(0, x - 1));
    }
    if (e.key === 'Enter' && results[selected]) {
      e.preventDefault();
      open(results[selected]);
    }
    if (e.key === ' ' && e.ctrlKey && results[selected]?.kind === 'file') {
      e.preventDefault();
      showPreview(results[selected]);
    }
  };
  return (
    <main className="workspace" onKeyDown={keyDown}>
      <div ref={panel} className={'launcher ' + (view === 'voice' ? 'voice-active' : '')}>
        <div className="input-rail" style={{ transform: `scaleX(${hold || 0})` }} />
        <div className="search-bar">
          <div className="brand-mark">
            <Zap size={23} strokeWidth={1.8} />
          </div>
          <input
            ref={input}
            autoFocus
            type="text"
            role="combobox"
            aria-label="Search Flare"
            aria-expanded={view === 'search' && results.length > 0}
            aria-controls={view === 'search' && query ? 'search-results' : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              view === 'search' && results[selected] ? 'result-' + selected : undefined
            }
            spellCheck={false}
            autoComplete="off"
            placeholder="Search anything..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (view !== 'search') setView('search');
            }}
          />
          {searching || busy ? (
            <LoaderCircle className="search-loader spin" size={17} />
          ) : query && settings?.ai.provider !== 'off' ? (
            <button
              className="icon-button ai-button"
              title="Interpret with AI"
              aria-label="Interpret with AI"
              onClick={aiSearch}
            >
              <Sparkles size={19} />
            </button>
          ) : null}
          <button
            className={'icon-button microphone ' + (view === 'voice' ? 'active' : '')}
            title="Voice command"
            aria-label="Voice command"
            onClick={() => setView(view === 'voice' ? 'search' : 'voice')}
          >
            <Mic size={19} />
          </button>
          <span className="search-divider" />
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => {
              setView(view === 'settings' ? 'search' : 'settings');
              setError('');
            }}
          >
            <Settings2 size={19} />
          </button>
        </div>
        {view === 'search' && query && (
          <div className="search-content">
            <div className="result-toolbar">
              <div className="filter-tabs" role="tablist" aria-label="Search source">
                {[
                  ['all', 'All'],
                  ['app', 'Apps'],
                  ['file', 'Files'],
                  ['links', 'Links'],
                  ['clipboard', 'Clipboard'],
                ].map(([value, label]) => (
                  <button
                    role="tab"
                    aria-selected={kind === value}
                    className={kind === value ? 'selected' : ''}
                    key={value}
                    onClick={() => setKind(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="result-count">
                {results.length ? results.length + ' results' : ''}
              </span>
            </div>
            <div
              id="search-results"
              role="listbox"
              aria-label="Search results"
              className="result-list"
            >
              {results.map((item, i) => {
                const Icon = icons[item.kind] || FileText;
                return (
                  <div
                    className={'result ' + (i === selected ? 'is-selected' : '')}
                    role="presentation"
                    key={item.id}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <button
                      className="result-main"
                      role="option"
                      aria-selected={i === selected}
                      id={'result-' + i}
                      tabIndex={i === selected ? 0 : -1}
                      onClick={() => open(item)}
                    >
                      <span className={'result-icon ' + item.kind}>
                        {item.icon ? (
                          <img src={item.icon} alt="" />
                        ) : (
                          <Icon size={19} strokeWidth={1.6} />
                        )}
                      </span>
                      <span className="result-text">
                        <span className="result-title">{item.title}</span>
                        <span className="result-detail">{item.detail}</span>
                      </span>
                    </button>
                    {item.contentMatch && <span className="content-tag">CONTENT</span>}
                    <span className="result-kind">
                      {item.kind === 'web'
                        ? 'Website'
                        : item.kind === 'setting'
                          ? 'Settings'
                          : item.kind === 'app'
                            ? 'App'
                            : item.kind === 'file'
                              ? 'File'
                              : item.kind === 'command'
                                ? 'Command'
                                : item.kind}
                    </span>
                    {i === selected && item.kind === 'file' ? (
                      <button
                        className="icon-button preview-button"
                        title="Preview (Ctrl+Space)"
                        aria-label={'Preview ' + item.title}
                        onClick={() => showPreview(item)}
                      >
                        <Eye size={16} />
                      </button>
                    ) : i === selected ? (
                      <CornerDownLeft className="result-enter" size={15} />
                    ) : (
                      <span className="result-spacer" />
                    )}
                  </div>
                );
              })}
            </div>
            {!searching && !results.length && (
              <div className="empty">
                <Search size={24} strokeWidth={1} />
                <span>{desktop ? 'No results' : 'No local results in browser preview'}</span>
              </div>
            )}
            {preview && (
              <section className="preview-panel">
                <div className="section-heading">
                  <span className="preview-title">{preview.name}</span>
                  <button
                    className="icon-button"
                    title="Close preview"
                    onClick={() => setPreview(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {preview.image ? (
                  <img className="file-preview" src={preview.image} alt={preview.name} />
                ) : preview.text ? (
                  <pre>{preview.text}</pre>
                ) : (
                  <div className="no-preview">
                    <FileText size={32} />
                    <p>No visual preview for this file.</p>
                  </div>
                )}
                <button className="metadata-toggle" onClick={() => setMetadata(!metadata)}>
                  <span>File details</span>
                  {metadata ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                {metadata && (
                  <dl className="metadata">
                    <dt>Size</dt>
                    <dd>{fileSize(preview.size)}</dd>
                    <dt>Type</dt>
                    <dd>{preview.type}</dd>
                    {preview.width && (
                      <>
                        <dt>Dimensions</dt>
                        <dd>
                          {preview.width} x {preview.height}
                        </dd>
                      </>
                    )}
                    {preview.pages && (
                      <>
                        <dt>Pages</dt>
                        <dd>{preview.pages}</dd>
                      </>
                    )}
                    <dt>Modified</dt>
                    <dd>{new Date(preview.modified).toLocaleString()}</dd>
                    <dt>Created</dt>
                    <dd>{new Date(preview.created).toLocaleString()}</dd>
                    {preview.taken && (
                      <>
                        <dt>Date taken</dt>
                        <dd>{new Date(preview.taken).toLocaleString()}</dd>
                      </>
                    )}
                    <dt>Location</dt>
                    <dd>{preview.path}</dd>
                  </dl>
                )}
              </section>
            )}
          </div>
        )}
        {view === 'settings' && settings && (
          <Settings value={settings} index={index} onChange={setSettings} onClose={reset} />
        )}
        {view === 'tools' && (
          <Tools
            initial={tool}
            autoConvert={!!autoConvert}
            onClose={reset}
            onPlan={(value) => {
              setPlan(value);
              setView('plan');
              if (autoConvert && value.type === 'convert') runPlan(undefined, value);
            }}
          />
        )}
        {view === 'plan' && plan && (
          <Plan key={plan.id} plan={plan} busy={busy} onRun={runPlan} onCancel={reset} />
        )}
        {view === 'voice' && settings && (
          <Voice
            settings={settings}
            onClose={reset}
            stopSignal={stopSignal}
            onTranscript={(text) => {
              reset();
              setQuery(text);
            }}
          />
        )}
        {view === 'history' && (
          <section className="history-panel">
            <div className="section-heading">
              <h2>Activity</h2>
              <button
                className="icon-button"
                title="Undo latest operation"
                aria-label="Undo latest operation"
                disabled={
                  busy ||
                  !history.some((x) =>
                    x.items.some((item) => ['done', 'started'].includes(item.status)),
                  )
                }
                onClick={() => undo()}
              >
                <Undo2 size={17} />
              </button>
              <button className="icon-button" title="Close history" onClick={reset}>
                <X size={17} />
              </button>
            </div>
            {!history.length ? (
              <div className="empty">
                <History size={26} strokeWidth={1} />
                <span>No file changes yet.</span>
              </div>
            ) : (
              <div className="history-list">
                {history.map((operation) => (
                  <div className="history-item" key={operation.id}>
                    <div className="history-top">
                      <div>
                        <h3 className="capitalize">{operation.title}</h3>
                        <small>
                          {new Date(operation.created).toLocaleString()} / {operation.items.length}{' '}
                          files
                        </small>
                      </div>
                      {operation.items.some((x) => ['done', 'started'].includes(x.status)) ? (
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() => undo(operation.id)}
                        >
                          <Undo2 size={14} /> Undo
                        </button>
                      ) : (
                        <Check size={17} />
                      )}
                    </div>
                    <span className="operation-status">{operation.status}</span>
                    {operation.type === 'convert' &&
                      operation.items
                        .filter((x) => x.outputSize !== undefined)
                        .map((item, i) => (
                          <p className="output-summary" key={i}>
                            {basename(item.to)} / {fileSize(item.outputSize)}
                          </p>
                        ))}
                    {operation.items
                      .filter((x) => x.error)
                      .map((x, i) => (
                        <p className="inline-error" key={i}>
                          {basename(x.from)}: {x.error}
                        </p>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {error && (
          <div className="error-strip" role="alert">
            <span>{error}</span>
            <button className="icon-button" title="Dismiss error" onClick={() => setError('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <Check size={14} />
            {notice}
          </div>
        )}
        <footer className="launcher-footer">
          <div className="footer-brand">
            <span>flare</span>
            <span className="footer-separator" />
            <span className={'status-dot ' + (index.state === 'indexing' ? 'active' : '')} />
            <button
              className="status-label"
              title={index.current || 'Search status'}
              onClick={() => setView('settings')}
            >
              {shortcutError
                ? 'Shortcut conflict'
                : index.state === 'indexing'
                  ? 'Indexing'
                  : settings && !settings.setup
                    ? 'Set up search'
                    : 'On this computer'}
            </button>
          </div>
          <div className="footer-tools">
            <button
              className="icon-button"
              title="File tools"
              aria-label="File tools"
              onClick={() => {
                setTool('');
                setView(view === 'tools' ? 'search' : 'tools');
              }}
            >
              <Wand2 size={15} />
            </button>
            <button
              className="icon-button"
              title="Activity & undo"
              aria-label="Activity and undo"
              onClick={showHistory}
            >
              <History size={15} />
            </button>
            <span className="footer-separator" />
            {query && results.length ? (
              <span className="key-hint">
                <kbd>Enter</kbd> Open
              </span>
            ) : (
              <span className="key-hint">
                <kbd>{settings?.shortcut?.replace('+', ' + ') || 'Alt + Space'}</kbd>
              </span>
            )}
          </div>
        </footer>
      </div>
      {!desktop && (
        <div className="browser-label">
          Flare / Browser preview<span>Native search and voice run in the desktop app.</span>
        </div>
      )}
    </main>
  );
}
