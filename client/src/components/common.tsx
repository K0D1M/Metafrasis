import { useEffect, useState, type ReactNode } from 'react';
import type { ProgressStats } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { useAuth } from '../lib/auth.js';
import { useTheme } from '../lib/theme.js';
import { ProfileModal } from './ProfileModal.js';

/* ── Πρόοδος ──────────────────────────────────────────────────────────────── */

export function ProgressBar({
  progress,
  showLabel = true,
}: {
  progress: ProgressStats;
  showLabel?: boolean;
}) {
  return (
    <div>
      {showLabel && (
        <div className="spread" style={{ marginBottom: '0.3rem' }}>
          <span className="muted">
            {progress.translated} / {progress.total}
          </span>
          <strong>{progress.percent}%</strong>
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────────── */

export function Avatar({
  username,
  avatarUrl,
  size = 32,
}: {
  username: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img className="avatar" src={avatarUrl} alt={username} style={{ width: size, height: size }} />
    );
  }
  // Fallback: το αρχικό γράμμα. Το [...username] σέβεται σύνθετους χαρακτήρες.
  const initial = [...username][0]?.toUpperCase() ?? '?';
  return (
    <div className="avatar" style={{ width: size, height: size }} title={username}>
      {initial}
    </div>
  );
}

/** Το avatar στην κορυφή· ένα κλικ ανοίγει το προφίλ όπου αλλάζει το avatar. */
export function AccountMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        className="ghost"
        onClick={() => setOpen(true)}
        style={{ padding: 0, border: 'none', borderRadius: '50%' }}
        title={user.username}
      >
        <Avatar username={user.username} avatarUrl={user.avatarUrl} />
      </button>
      {open && <ProfileModal onClose={() => setOpen(false)} />}
    </>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────────── */

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Το Escape κλείνει το παράθυρο — αναμενόμενο από κάθε modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="spread" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label={el.app.close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Θέμα ─────────────────────────────────────────────────────────────────── */

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="ghost" onClick={toggle} title={theme === 'dark' ? el.theme.toLight : el.theme.toDark}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

/* ── Κενή κατάσταση ───────────────────────────────────────────────────────── */

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {hint && <div>{hint}</div>}
      {children && <div style={{ marginTop: '1rem' }}>{children}</div>}
    </div>
  );
}

/* ── Μορφοποίηση ημερομηνίας ──────────────────────────────────────────────── */

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('el-GR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
