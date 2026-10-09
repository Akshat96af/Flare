import { useEffect, useRef, useState } from 'react';
import { X, File, FolderOpen, Copy, Check, Share2, Square, LoaderCircle } from 'lucide-react';
import { bridge, fileSize } from './bridge';

type ShareStatus = {
  active: boolean;
  addresses: string[];
  name?: string;
  size?: number;
  url?: string;
  qrDataUrl?: string;
  expiresAt?: number;
  downloads?: number;
};
export default function QuickShare({
  initialFileId,
  onClose,
}: {
  initialFileId?: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ShareStatus>({ active: false, addresses: [] }),
    [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null),
    [address, setAddress] = useState(''),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false),
    [now, setNow] = useState(Date.now());
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await bridge.call('share-status');
      if (active) {
        setStatus(next);
        setAddress((current) =>
          next.addresses.includes(current) ? current : next.addresses[0] || '',
        );
      }
      return next;
    };
    (async () => {
      try {
        const next = await refresh();
        if (initialFileId && !next.active) {
          const chosen = await bridge.call('share-pick', { id: initialFileId });
          if (active) setFile(chosen);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setBusy(false);
      }
    })();
    const remove = bridge.on('share', () => refresh().catch(() => {}));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      remove();
      clearInterval(tick);
    };
  }, [initialFileId]);
  const run = async (task: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const seconds = Math.min(600, Math.max(0, Math.ceil(((status.expiresAt || now) - now) / 1000)));
  return (
    <section className="share-panel" aria-label="Quick Share">
      <div className="section-heading">
        <h2>Quick Share</h2>
        <button className="icon-button" title="Close Quick Share" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="share-content">
        {status.active ? (
          <>
            <div className="share-live">
              <span className="status-dot active" />
              <span>Sharing on your network</span>
              <span className="share-countdown" aria-label="Time remaining">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </span>
            </div>
            <div className="share-transfer">
              {status.qrDataUrl && (
                <img
                  className="share-qr"
                  src={status.qrDataUrl}
                  width="176"
                  height="176"
                  alt="QR code for this temporary download"
                />
              )}
              <div className="share-details">
                <File size={24} />
                <h3>{status.name}</h3>
                <span>{fileSize(status.size)}</span>
                <span>{status.downloads || 0} completed downloads</span>
              </div>
            </div>
            <label className="field-label">
              Download link
              <input aria-label="Download link" readOnly value={status.url || ''} />
            </label>
            <div className="button-row">
              <button
                className="subtle"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await bridge.call('share-copy');
                    setCopied(true);
                  })
                }
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}{' '}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setStatus(await bridge.call('share-stop'));
                    setConsent(false);
                    setCopied(false);
                  })
                }
              >
                <Square size={13} /> Stop sharing
              </button>
            </div>
            <p className="share-disclosure">
              Anyone with this link on the same network can download the file until it expires.
              Closing this panel keeps the share active.
            </p>
          </>
        ) : (
          <>
            <button
              className="share-file-picker"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const chosen = await bridge.call('share-pick');
                  if (chosen) {
                    setFile(chosen);
                    setConsent(false);
                  }
                })
              }
            >
              <FolderOpen size={25} />
              <span>
                <strong>{file?.name || 'Choose a file'}</strong>
                <small>{file ? fileSize(file.size) : 'On this computer'}</small>
              </span>
              {busy && <LoaderCircle size={16} className="spin" />}
            </button>
            <label className="field-label">
              Network
              <select
                aria-label="Share network"
                value={address}
                disabled={busy || !status.addresses.length}
                onChange={(event) => setAddress(event.target.value)}
              >
                {!status.addresses.length && <option value="">No private network found</option>}
                {status.addresses.map((ip) => (
                  <option key={ip} value={ip}>
                    {ip}
                  </option>
                ))}
              </select>
            </label>
            <p className="share-disclosure">
              A temporary link, valid for 10 minutes. No hosting or account. Transfers use
              unencrypted HTTP on your local network; only share on trusted Wi-Fi or Ethernet.
              Windows Firewall may ask for private-network access.
            </p>
            <label className="share-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>I trust this network and want to share this file.</span>
            </label>
            <button
              className="primary"
              disabled={busy || !file || !address || !consent}
              onClick={() =>
                run(async () => {
                  setStatus(
                    await bridge.call('share-start', { id: file!.id, address, confirm: true }),
                  );
                  setCopied(false);
                })
              }
            >
              <Share2 size={16} /> Start sharing
            </button>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
