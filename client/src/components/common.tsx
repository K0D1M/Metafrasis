import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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

function ShieldIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 2l7 3.2v5.4c0 5-3.2 8.7-7 10.4-3.8-1.7-7-5.4-7-10.4V5.2L12 2Zm0 4.1L8 7.8v2.8c0 3.3 2 5.9 4 7 2-1.1 4-3.7 4-7V7.8l-4-1.7Z" />
    </svg>
  );
}

/** Ορατό μόνο σε γενικούς διαχειριστές — δεν υπάρχει καθόλου menu να μπει μέσα. */
export function AdminLink() {
  const { user } = useAuth();
  if (!user?.isAdmin) return null;

  return (
    <Link to="/admin">
      <button
        className="primary icon-btn"
        type="button"
        style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--accent-contrast)' }}
      >
        <ShieldIcon />
        {el.admin.title}
      </button>
    </Link>
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
