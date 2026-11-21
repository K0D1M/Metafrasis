import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationView } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api } from '../lib/api.js';
import { enableDesktopNotifications, useDesktopNotificationState } from '../lib/push.js';
import { Icon } from './Icon.js';

const POLL_MS = 30_000;
/** Ο χρήστης είπε «Όχι τώρα» στην πρόταση ενεργοποίησης — δεν την ξαναδείχνουμε σε αυτή τη συσκευή. */
const PUSH_PROMPT_DISMISSED_KEY = 'metafrasis.pushPromptDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Ίδιο μοτίβο μορφοποίησης ώρας με το ActivityTab — η στιγμή έχει σημασία εδώ. */
function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('el-GR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Κουδούνι ειδοποιήσεων· ζει στην κορυφή δίπλα στο AccountMenu, στα ίδια σημεία
 * (ProjectList και ProjectWindow) — δεν υπάρχει κοινό layout wrapper σε αυτό το app,
 * οπότε ακολουθούμε το ίδιο μοτίβο επανάληψης που έχουν ήδη το ThemeToggle/AccountMenu.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pushState, setPushState] = useDesktopNotificationState();
  const [promptDismissed, setPromptDismissed] = useState(readDismissed);

  function pollCount() {
    api
      .get<{ count: number }>('/notifications/unread-count')
      .then((r) => setCount(r.count))
      .catch(() => {});
  }

  useEffect(() => {
    pollCount();
    const interval = setInterval(pollCount, POLL_MS);
    // Με ενεργές ειδοποιήσεις επιφάνειας εργασίας, ο service worker μάς ειδοποιεί αμέσως.
    function onWorkerMessage(event: MessageEvent) {
      if ((event.data as { type?: string } | null)?.type === 'metafrasis:notification') pollCount();
    }
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
    return () => {
      clearInterval(interval);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    };
  }, []);

  function dismissPrompt() {
    setPromptDismissed(true);
    try {
      localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Χωρίς αποθήκευση απλώς θα ξαναεμφανιστεί στην επόμενη φόρτωση.
    }
  }

  async function enablePush() {
    try {
      setPushState(await enableDesktopNotifications());
    } catch {
      // Η αναλυτική εικόνα (και το μήνυμα σφάλματος) ζει στον διακόπτη του προφίλ.
    }
  }

  useEffect(() => {
    if (!open) return;
    api
      .get<NotificationView[]>('/notifications?limit=20')
      .then(setItems)
      .catch(() => setItems([]));
  }, [open]);

  // Κλικ έξω από το dropdown το κλείνει — ίδια λογική με το Escape στο Modal.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function openItem(item: NotificationView) {
    if (!item.read) {
      await api.post(`/notifications/${item.id}/read`);
      setItems((current) =>
        current?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? current,
      );
      setCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  async function markAllRead() {
    await api.post('/notifications/read-all');
    setItems((current) => current?.map((n) => ({ ...n, read: true })) ?? current);
    setCount(0);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="ghost"
        onClick={() => setOpen((v) => !v)}
        title={el.notifications.title}
        style={{ position: 'relative' }}
      >
        🔔
        {count > 0 && (
          <span
            className="badge"
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: 'var(--danger)',
              color: 'var(--accent-contrast)',
              fontSize: '0.7em',
              padding: '0.05rem 0.35rem',
              minWidth: '1.2em',
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            right: 0,
            width: 320,
            maxHeight: 400,
            overflowY: 'auto',
            zIndex: 40,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div className="spread" style={{ marginBottom: '0.6rem' }}>
            <strong>{el.notifications.title}</strong>
            {items && items.some((n) => !n.read) && (
              <button
                className="ghost icon-btn"
                style={{ fontSize: '0.85em' }}
                onClick={() => void markAllRead()}
              >
                <Icon name="save" size={14} />
                {el.notifications.markAllRead}
              </button>
            )}
          </div>

          {pushState === 'off' && !promptDismissed && (
            <div className="push-prompt">
              <div className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
                <Icon name="bell" size={16} />
                <span>{el.desktopNotifications.bellPrompt}</span>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button className="ghost" style={{ fontSize: '0.9em' }} onClick={dismissPrompt}>
                  {el.desktopNotifications.bellPromptDismiss}
                </button>
                <button className="primary" style={{ fontSize: '0.9em' }} onClick={() => void enablePush()}>
                  {el.desktopNotifications.bellPromptAction}
                </button>
              </div>
            </div>
          )}

          {items === null ? (
            <div className="muted">{el.app.loading}</div>
          ) : items.length === 0 ? (
            <div className="muted">{el.notifications.empty}</div>
          ) : (
            <div className="stack" style={{ gap: '0.5rem' }}>
              {items.map((item) => (
                <button
                  key={item.id}
                  className="ghost"
                  onClick={() => void openItem(item)}
                  style={{
                    textAlign: 'start',
                    display: 'block',
                    width: '100%',
                    background: item.read ? 'transparent' : 'var(--surface-2)',
                  }}
                >
                  <div>
                    {el.notificationTypes[item.type] ?? item.type}
                    {item.target && <> «{item.target}»</>}
                  </div>
                  <div className="muted" style={{ fontSize: '0.85em' }}>
                    {item.projectName} · {formatMoment(item.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
