import { useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, ScanText, X } from 'lucide-react';
import { bridge } from './bridge';
import type { Result } from './types';
export default function ReadText({ item, onClose }: { item: Result; onClose: () => void }) {
  const [result, setResult] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState(''),
    [copied, setCopied] = useState(false),
    [progress, setProgress] = useState('Reading text locally');
  const started = useRef(false);
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
          <h2>Text from file</h2>
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
        </>
      )}
    </section>
  );
}
