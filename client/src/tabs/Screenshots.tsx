import { useEffect, useRef, useState } from 'react';
import {
  MAX_SCREENSHOT_BYTES,
  Role,
  type ScreenshotView,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { Avatar, EmptyState, Modal, formatDate } from '../components/common.js';
import { useAuth } from '../lib/auth.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

const MAX_MB = Math.round(MAX_SCREENSHOT_BYTES / (1024 * 1024));

export function ScreenshotsTab({ project }: { project: ProjectDetail }) {
  const { user } = useAuth();
  const [items, setItems] = useState<ScreenshotView[] | null>(null);
  const [preview, setPreview] = useState<ScreenshotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function reload() {
    api
      .get<ScreenshotView[]>(`/projects/${project.id}/screenshots`)
      .then(setItems)
      .catch(() => setItems([]));
  }

  useEffect(reload, [project.id]);

  async function handleUpload(file: File) {
    setError(null);
    // Ο έλεγχος γίνεται και στον server· εδώ γλιτώνουμε ένα άσκοπο ανέβασμα.
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError(`Το αρχείο ξεπερνά το όριο των ${MAX_MB} MB`);
      return;
    }
    setBusy(true);
    try {
      await api.upload(`/projects/${project.id}/screenshots`, file);
      reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: ScreenshotView) {
    if (!confirm(el.screenshots.confirmDelete(item.originalName))) return;
    try {
      await api.delete(`/projects/${project.id}/screenshots/${item.id}`);
      setPreview(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  if (!items) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{el.screenshots.title}</h2>
          <span className="muted">{el.screenshots.maxSize(MAX_MB)}</span>
        </div>
        <button className="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? el.app.loading : el.screenshots.upload}
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUpload(file);
          event.target.value = '';
        }}
      />

      {error && <div className="field-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {items.length === 0 ? (
        <div className="card">
          <EmptyState title={el.screenshots.empty} hint={el.screenshots.emptyHint} />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              className="card"
              onClick={() => setPreview(item)}
              style={{ padding: 0, overflow: 'hidden', textAlign: 'start', cursor: 'zoom-in' }}
            >
              <img
                src={item.url}
                alt={item.originalName}
                loading="lazy"
                style={{
                  width: '100%',
                  aspectRatio: '16 / 10',
                  objectFit: 'cover',
                  display: 'block',
                  background: 'var(--surface-2)',
                }}
              />
              <div style={{ padding: '0.6rem' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.originalName}
                </div>
                <div className="row muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
                  <Avatar
                    username={item.uploader.username}
                    avatarUrl={item.uploader.avatarUrl}
                    size={20}
                  />
                  {item.uploader.username} · {formatDate(item.uploadedAt)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {preview && (
        <Modal title={preview.originalName} onClose={() => setPreview(null)}>
          <img
            src={preview.url}
            alt={preview.originalName}
            style={{ width: '100%', borderRadius: 'var(--radius-sm)' }}
          />
          <div className="spread" style={{ marginTop: '0.75rem' }}>
            <span className="muted">
              {el.screenshots.uploadedBy}: {preview.uploader.username} ·{' '}
              {(preview.sizeBytes / 1024).toFixed(0)} KB
            </span>
            {(preview.uploader.id === user?.id || project.role === Role.MANAGER) && (
              <button className="ghost danger" onClick={() => void handleDelete(preview)}>
                {el.app.delete}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
