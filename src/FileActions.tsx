import { useEffect, useState } from 'react';
import {
  Eye,
  Share2,
  FolderOpen,
  Copy,
  Sparkles,
  ScanText,
  Image,
  Scaling,
  Archive,
  FileText,
  Scissors,
  X,
  LoaderCircle,
} from 'lucide-react';
import { bridge } from './bridge';
import type { Result } from './types';
export type FileAction = { id: string; title: string; icon: string; tool?: string };
const icons: Record<string, typeof Eye> = {
  preview: Eye,
  share: Share2,
  folder: FolderOpen,
  copy: Copy,
  sparkles: Sparkles,
  text: ScanText,
  image: Image,
  resize: Scaling,
  compress: Archive,
  pdf: FileText,
  split: Scissors,
};
export default function FileActions({
  item,
  onAction,
  onClose,
}: {
  item: Result;
  onAction: (action: FileAction) => void;
  onClose: () => void;
}) {
  const [actions, setActions] = useState<FileAction[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setActions([]);
    setError('');
    bridge
      .call('file-actions', { id: item.id })
      .then((actions) => {
        if (active) setActions(actions);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [item.id]);
  return (
    <section className="file-action-tray" aria-label={'Actions for ' + item.title}>
      <div className="section-heading">
        <span className="preview-title">{item.title}</span>
        <button
          className="icon-button"
          aria-label="Close file actions"
          title="Close file actions"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : actions.length ? (
        <div className="file-action-grid">
          {actions.map((action) => {
            const Icon = icons[action.icon] || FileText;
            return (
              <button className="file-action" key={action.id} onClick={() => onAction(action)}>
                <Icon size={17} />
                <span>{action.title}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <LoaderCircle size={18} className="spin" aria-label="Loading file actions" />
      )}
    </section>
  );
}
