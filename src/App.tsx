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
  Copy,
  Share2,
  FolderOpen,
} from 'lucide-react';
import { bridge, desktop, basename, fileSize } from './bridge';
import type { Result, Settings as Prefs, IndexStatus, Operation } from './types';
import Settings from './Settings';
import Tools, { Plan } from './Tools';
import Voice from './Voice';
import QuickShare from './QuickShare';
import GlassRail from './GlassRail';
import { usePressFeedback } from './usePressFeedback';

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
    [searchResults, setResults] = useState<Result[]>([]),
    [resultContext, setResultContext] = useState(''),
    [selected, setSelected] = useState(0),
    [kind, setKind] = useState('all'),
    [view, setView] = useState('search'),
    [tool, setTool] = useState(''),
    [toolMode, setToolMode] = useState('type'),
    [settingsPage, setSettingsPage] = useState('general'),
    [aiAnswer, setAiAnswer] = useState(''),
    [aiBusy, setAiBusy] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [metadata, setMetadata] = useState(false),
    [hold, setHold] = useState(0),
    [stopSignal, setStopSignal] = useState(0),
    [history, setHistory] = useState<Operation[]>([]),
    [plan, setPlan] = useState<Operation | null>(null),
    [busy, setBusy] = useState(false),
    [searchPending, setSearching] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [shortcutError, setShortcutError] = useState('');
  const [shareId, setShareId] = useState<string | undefined>(),
    [shareActive, setShareActive] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLDivElement>(null),
    sequence = useRef(0),
    aiSequence = useRef(0),
    aiPending = useRef(false),
    previewSequence = useRef(0),
    entrance = useRef<Animation | null>(null),
    viewRef = useRef(view),
    busyRef = useRef(busy);
  const searchContext = query + '\0' + kind;
  const results = resultContext === searchContext ? searchResults : [];
  const searching =
    view === 'search' && !!query.trim() && (searchPending || resultContext !== searchContext);
  usePressFeedback(panel);
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
      bridge.on('share', (data) => setShareActive(data.active)),
      bridge.on('activation', (data) => {
        if (data.contentHeight)
          document.documentElement.style.setProperty('--content-height', data.contentHeight + 'px');
        if (!busyRef.current) {
          setView(data.mode === 'settings' ? 'settings' : 'search');
          setQuery('');
          setPreview(null);
          setResults([]);
          setError('');
          setAiAnswer('');
          setSettingsPage('general');
        }
        entrance.current?.cancel();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
          entrance.current =
            panel.current?.animate(
              [
                { opacity: 0, transform: 'translateY(-8px) scale(.985)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' },
              ],
              { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' },
            ) || null;
        input.current?.focus();
      }),
      bridge.on('dismiss', () => {
        sequence.current++;
        previewSequence.current++;
        entrance.current?.cancel();
        setPreviewBusy(false);
        setSearching(false);
        aiSequence.current++;
        aiPending.current = false;
        setAiBusy(false);
        setHold(0);
        if (viewRef.current === 'voice') setView('search');
      }),
      bridge.on('hold', (data) => setHold(data.progress)),
      bridge.on('voice', (data) => {
        if (data.action === 'start' && !busyRef.current) setView('voice');
        else setStopSignal((x) => x + 1);
      }),
      bridge.on('index', setIndex),
      bridge.on('theme', (data) => setDark(data.dark)),
      bridge.on('operation', (data) =>
        setPlan((current) => (current?.id === data.id ? data : current)),
      ),
    ];
    return () => {
      disposers.forEach((dispose) => dispose());
      entrance.current?.cancel();
    };
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      bridge.call('hide').catch(() => {});
    };
    window.addEventListener('keydown', dismiss, true);
    return () => window.removeEventListener('keydown', dismiss, true);
  }, []);
  useEffect(() => {
    aiSequence.current++;
    if (aiPending.current) bridge.call('ai-cancel').catch(() => {});
    aiPending.current = false;
    setAiBusy(false);
    setAiAnswer('');
  }, [query, settings?.ai.provider, settings?.ai.model]);
  useEffect(() => {
    if (view === 'search' || !aiPending.current) return;
    aiSequence.current++;
    aiPending.current = false;
    setAiBusy(false);
    bridge.call('ai-cancel').catch(() => {});
  }, [view]);
  useEffect(() => {
    const isDark = settings?.theme === 'dark' || (settings?.theme === 'system' && dark);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.dataset.glass = settings?.glass === false ? 'off' : 'on';
  }, [settings, dark]);
  useEffect(() => {
    if (!panel.current) return;
    let frame = 0,
      lastHeight = 0,
      height = 0;
    const observer = new ResizeObserver((entries) => {
      height = Math.ceil(entries[0].contentRect.height) + 74;
      if (frame || height === lastHeight) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        lastHeight = height;
        bridge.call('resize', { height }).catch(() => {});
      });
    });
    observer.observe(panel.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    previewSequence.current++;
    setPreviewBusy(false);
    setPreview(null);
  }, [query, kind, view]);
  useEffect(() => {
    if (view === 'search') requestAnimationFrame(() => input.current?.focus());
  }, [view]);
  useEffect(() => {
    document.getElementById('result-' + selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  useEffect(() => {
    const id = ++sequence.current;
    if (view !== 'search') {
      setSearching(false);
      return;
    }
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
            setResultContext(query + '\0' + kind);
            setSelected(0);
            setSearching(false);
          }
        })
        .catch((e) => {
          if (sequence.current === id) {
            setError(e.message);
            setResults([]);
            setResultContext(query + '\0' + kind);
            setSearching(false);
          }
        });
    }, 80);
    return () => clearTimeout(timer);
  }, [
    query,
    kind,
    view,
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
  const handleIntent = async (intent: any) => {
    if (intent?.kind === 'tool') {
      setTool(intent.tool);
      setToolMode(intent.mode || 'type');
      setView('tools');
    } else if (intent?.kind === 'search') {
      setView('search');
      setQuery(intent.query);
      if (intent.query === query)
        setNotice('Search unchanged. Check your search locations for missing files.');
    } else if (intent?.kind === 'answer') {
      setView('search');
      setAiAnswer(intent.text);
    } else if (intent) {
      const value = await bridge.call('open', { intent });
      setNotice(value.message || '');
    }
  };
  const open = (item: Result) =>
    act(async () => {
      const result = await bridge.call('open', { id: item.id });
      if (result.intent) await handleIntent(result.intent);
      if (result.message) setNotice(result.message);
    });
  const showPreview = async (item: Result) => {
    const id = ++previewSequence.current;
    setPreviewBusy(true);
    setError('');
    try {
      const value = await bridge.call('preview', { id: item.id });
      if (id !== previewSequence.current) return;
      setPreview(value);
      setMetadata(false);
    } catch (error) {
      if (id === previewSequence.current) setError((error as Error).message);
    } finally {
      if (id === previewSequence.current) setPreviewBusy(false);
    }
  };
  const showHistory = () => {
    setView('history');
    setHistory([]);
    return act(async () => {
      setHistory(await bridge.call('history'));
    });
  };
  const runPlan = (selection?: number[], value = plan) =>
    act(async () => {
      if (!value || busyRef.current) return;
      busyRef.current = true;
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
        busyRef.current = false;
        setBusy(false);
      }
    });
  const autoConvert =
    settings?.trust === 'balanced' ||
    (settings?.trust === 'custom' && !settings.confirmConversions);
  const undo = (id?: string) =>
    act(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
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
        busyRef.current = false;
        setBusy(false);
      }
    });
  const intelligenceOn = !!settings?.ai.model && settings.ai.provider !== 'off';
  const aiSearch = async () => {
    if (busy || aiPending.current || !query.trim() || !intelligenceOn) return;
    const id = ++aiSequence.current;
    aiPending.current = true;
    setAiBusy(true);
    setAiAnswer('');
    setError('');
    try {
      const intent = await bridge.call('ai-plan', { query });
      if (aiSequence.current === id) await handleIntent(intent);
    } catch (e) {
      if (aiSequence.current === id) setError((e as Error).message);
    } finally {
      if (aiSequence.current === id) {
        aiPending.current = false;
        setAiBusy(false);
      }
    }
  };
  const reset = () => {
    setView('search');
    setPreview(null);
    setPlan(null);
    setError('');
  };
  const keyDown = (e: React.KeyboardEvent) => {
    if (view !== 'search' || e.target !== input.current || e.nativeEvent.isComposing) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !query) {
      e.preventDefault();
      undo();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((x) => Math.max(0, Math.min(results.length - 1, x + 1)));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((x) => Math.max(0, x - 1));
    }
    if (e.key === 'Enter' && !searching && results[selected]) {
      e.preventDefault();
      open(results[selected]);
    } else if (e.key === 'Enter' && !searching && !results.length && intelligenceOn && !aiAnswer) {
      e.preventDefault();
      aiSearch();
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
        <GlassRail enabled={settings?.glass !== false}>
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
            aria-controls={view === 'search' && results.length ? 'search-results' : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              view === 'search' && results[selected] ? 'result-' + selected : undefined
            }
            spellCheck={false}
            autoComplete="off"
            placeholder="Search anything..."
            value={query}
            readOnly={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              if (view !== 'search') setView('search');
            }}
          />
          <span className="search-action-slot">
            {searching || busy || aiBusy || previewBusy ? (
              <LoaderCircle className="search-loader spin" size={17} />
            ) : query && intelligenceOn ? (
              <button
                className="icon-button ai-button"
                title="Ask AI"
                aria-label="Ask AI"
                onClick={aiSearch}
              >
                <Sparkles size={19} />
              </button>
            ) : null}
          </span>
          <button
            className={'icon-button microphone ' + (view === 'voice' ? 'active' : '')}
            title="Voice command"
            aria-label="Voice command"
            aria-pressed={view === 'voice'}
            disabled={busy}
            onClick={() => setView(view === 'voice' ? 'search' : 'voice')}
          >
            <Mic size={19} />
          </button>
          <span className="search-divider" />
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            aria-pressed={view === 'settings'}
            disabled={busy}
            onClick={() => {
              setSettingsPage('general');
              setView(view === 'settings' ? 'search' : 'settings');
              setError('');
            }}
          >
            <Settings2 size={19} />
          </button>
        </GlassRail>
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
                    tabIndex={kind === value ? 0 : -1}
                    className={kind === value ? 'selected' : ''}
                    key={value}
                    onClick={() => setKind(value)}
                    onKeyDown={(event) => {
                      const tabs = Array.from(
                        event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                          '[role="tab"]',
                        ),
                      );
                      const current = tabs.indexOf(event.currentTarget);
                      const next =
                        event.key === 'ArrowRight'
                          ? (current + 1) % tabs.length
                          : event.key === 'ArrowLeft'
                            ? (current + tabs.length - 1) % tabs.length
                            : event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? tabs.length - 1
                                : -1;
                      if (next < 0) return;
                      event.preventDefault();
                      tabs[next].focus();
                      tabs[next].click();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="result-actions">
                <span className="result-count">
                  {results.length
                    ? results.length + (results.length === 1 ? ' result' : ' results')
                    : ''}
                </span>
                {results[selected]?.kind === 'file' && (
                  <>
                    <button
                      className="icon-button"
                      title="Share file"
                      aria-label="Share file"
                      onClick={() => {
                        setShareId(results[selected].id);
                        setView('share');
                      }}
                    >
                      <Share2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title="Show in folder"
                      aria-label="Show in folder"
                      onClick={() =>
                        act(async () => {
                          const result = await bridge.call('result-action', {
                            id: results[selected].id,
                            action: 'reveal',
                          });
                          setNotice(result.message);
                        })
                      }
                    >
                      <FolderOpen size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title="Copy path"
                      aria-label="Copy path"
                      onClick={() =>
                        act(async () => {
                          const result = await bridge.call('result-action', {
                            id: results[selected].id,
                            action: 'copy-path',
                          });
                          setNotice(result.message);
                        })
                      }
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="icon-button preview-button"
                      title="Preview (Ctrl+Space)"
                      aria-label={'Preview ' + results[selected].title}
                      onClick={() => showPreview(results[selected])}
                    >
                      <Eye size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div
              id="search-results"
              role={results.length ? 'listbox' : undefined}
              aria-label={results.length ? 'Search results' : undefined}
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
                    {i === selected ? (
                      <CornerDownLeft className="result-enter" size={15} />
                    ) : (
                      <span className="result-spacer" />
                    )}
                  </div>
                );
              })}
            </div>
            {!searching && !results.length && !aiAnswer && (
              <div className="empty">
                {aiBusy ? (
                  <LoaderCircle size={24} className="spin" />
                ) : (
                  <Search size={24} strokeWidth={1} />
                )}
                <span>{desktop ? 'No results' : 'No local results in browser preview'}</span>
                {intelligenceOn && (
                  <button className="subtle ask-ai" onClick={aiSearch} disabled={busy || aiBusy}>
                    <Sparkles size={16} /> {aiBusy ? 'Asking AI...' : 'Ask AI'}
                  </button>
                )}
              </div>
            )}
            {aiAnswer && (
              <section className="ai-answer" aria-label="AI answer">
                <div className="section-heading">
                  <span className="ai-answer-label">
                    <Sparkles size={15} /> AI answer
                  </span>
                  <button
                    className="icon-button"
                    title="Copy answer"
                    aria-label="Copy answer"
                    onClick={() =>
                      act(async () => {
                        await navigator.clipboard.writeText(aiAnswer);
                        setNotice('Answer copied');
                      })
                    }
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <p>{aiAnswer}</p>
              </section>
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
                <button
                  className="metadata-toggle"
                  aria-expanded={metadata}
                  onClick={() => setMetadata(!metadata)}
                >
                  <span>File details</span>
                  <ChevronDown size={15} />
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
          <Settings
            value={settings}
            index={index}
            initialPage={settingsPage}
            onChange={setSettings}
            onClose={reset}
          />
        )}
        {view === 'share' && <QuickShare initialFileId={shareId} onClose={reset} />}
        {view === 'tools' && (
          <Tools
            initial={tool}
            initialMode={toolMode}
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
            onSettings={() => {
              setSettingsPage('ai');
              setView('settings');
            }}
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
            {error.includes('AI provider') && (
              <button
                className="text-button"
                onClick={() => {
                  setSettingsPage('ai');
                  setView('settings');
                  setError('');
                }}
              >
                Intelligence settings
              </button>
            )}
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
              disabled={busy}
              title={index.current || 'Search status'}
              onClick={() => {
                setSettingsPage('general');
                setView('settings');
              }}
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
              className={'icon-button ' + (shareActive ? 'share-active' : '')}
              title={shareActive ? 'Quick Share active' : 'Quick Share'}
              aria-label="Quick Share"
              aria-pressed={view === 'share'}
              disabled={busy}
              onClick={() => {
                setShareId(undefined);
                setView(view === 'share' ? 'search' : 'share');
              }}
            >
              <Share2 size={15} />
            </button>
            <button
              className="icon-button"
              title="File tools"
              aria-label="File tools"
              aria-pressed={view === 'tools'}
              disabled={busy}
              onClick={() => {
                setTool('');
                setToolMode('type');
                setView(view === 'tools' ? 'search' : 'tools');
              }}
            >
              <Wand2 size={15} />
            </button>
            <button
              className="icon-button"
              title="Activity & undo"
              aria-label="Activity and undo"
              aria-pressed={view === 'history'}
              disabled={busy}
              onClick={showHistory}
            >
              <History size={15} />
            </button>
            <span className="footer-separator" />
            {view === 'search' && query && results.length ? (
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
