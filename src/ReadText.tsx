import { useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, ScanText, Sparkles, X } from 'lucide-react';
import { bridge } from './bridge';
import type { Result } from './types';
import TypedAnswer from './TypedAnswer';
export default function ReadText({
  item,
  onClose,
  intelligence = false,
}: {
  item: Result;
  onClose: () => void;
  intelligence?: boolean;
}) {
  const [result, setResult] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState(''),
    [copied, setCopied] = useState(false),
    [progress, setProgress] = useState('Reading text locally');
  const started = useRef(false);
  const [task, setTask] = useState('summary'),
    [answer, setAnswer] = useState(''),
    [aiError, setAiError] = useState(''),
    [aiBusy, setAiBusy] = useState(false);
  const request = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      request.current++;
      if (pending.current) bridge.call('ai-cancel').catch(() => {});
    },
    [],
  );
  const enhance = async () => {
    if (pending.current) return;
    const id = ++request.current;
    pending.current = true;
    setAiBusy(true);
    setAiError('');
    setAnswer('');
    try {
      const result = await bridge.call('ocr-enhance', { id: item.id, task });
      if (request.current === id) setAnswer(result.text);
    } catch (error) {
      if (request.current === id) setAiError((error as Error).message);
    } finally {
      if (request.current === id) {
        pending.current = false;
        setAiBusy(false);
      }
    }
  };
  useEffect(() => {
    let active = true;
    const remove = bridge.on('ocr-progress', (data) => {
      if (active && data.id === item.id) setProgress(`Reading page ${data.page} of ${data.pages}`);
    });
    // Delay startup until after Strict Mode's disposable mount.
    const timer = setTimeout(() => {
      started.current = true;
      bridge
        .call('file-ocr', { id: item.id })
        .then((value) => {
          if (active) setResult(value);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      remove();
      if (started.current) bridge.call('file-ocr-cancel').catch(() => {});
    };
  }, [item.id]);
  return (
    <section className="read-text-panel" aria-label="Local text recognition">
      <div className="section-heading">
        <div className="heading-group">
          <ScanText size={18} />
          <h2>{item.clipboardImage ? 'Text from screenshot' : 'Text from file'}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close text recognition"
          title="Close text recognition"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="read-text-name">{item.title}</p>
      {error ? (
        <p role="alert" className="inline-error">
          {error}
        </p>
      ) : !result ? (
        <div className="read-text-loading" role="status">
          <LoaderCircle className="spin" size={22} />
          <span>{progress}</span>
        </div>
      ) : (
        <>
          <textarea
            className="read-text-output"
            aria-label="Recognized text"
            value={result.text}
            readOnly
            placeholder="No readable text found."
          />
          <div className="panel-actions">
            <span className="muted small">
              {result.truncated ? 'First 10 pages / partial text' : 'Processed on this computer'}
            </span>
            <button
              className="subtle"
              disabled={!result.text}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.text);
                  setCopied(true);
                } catch {
                  setError('Could not copy text. Try again.');
                }
              }}
            >
              <Copy size={15} />
              {copied ? 'Copied' : 'Copy text'}
            </button>
          </div>
          {intelligence && result.text && (
            <div className="text-intelligence">
              <div className="text-intelligence-controls">
                <label className="field-label">
                  AI text action
                  <select
                    aria-label="AI text action"
                    value={task}
                    disabled={aiBusy}
                    onChange={(event) => setTask(event.target.value)}
                  >
                    <option value="summary">Summarize</option>
                    <option value="cleanup">Clean up text</option>
                    <option value="action-items">Extract action items</option>
                  </select>
                </label>
                <button className="subtle" disabled={aiBusy} onClick={enhance}>
                  {aiBusy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                  {aiBusy ? 'Processing' : 'Process with AI'}
                </button>
              </div>
              {aiError && (
                <p className="inline-error" role="alert">
                  {aiError}
                </p>
              )}
              {answer && (
                <>
                  <TypedAnswer key={answer} text={answer} />
                  <button
                    className="icon-button"
                    title="Copy AI result"
                    aria-label="Copy AI result"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(answer);
                      } catch {
                        setAiError('Could not copy the AI result.');
                      }
                    }}
                  >
                    <Copy size={16} />
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
