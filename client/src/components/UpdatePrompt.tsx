import { useRegisterSW } from 'virtual:pwa-register/react';
import { el } from '../i18n/el.js';
import { Icon } from './Icon.js';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Μετά από deploy, το ήδη ανοιχτό παράθυρο τρέχει ακόμα τον παλιό κώδικα. Δεν κάνουμε
 * αυτόματο reload — θα έχανε μια μετάφραση που γράφεται εκείνη τη στιγμή (αποθηκεύεται
 * στο blur) — αλλά ειδοποιούμε και αφήνουμε τον χρήστη να επιλέξει πότε.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Ένα παράθυρο που μένει ανοιχτό όλη μέρα αλλιώς θα έβλεπε νέα έκδοση μόνο στο επόμενο άνοιγμα.
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="card row"
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        boxShadow: 'var(--shadow)',
        gap: '0.75rem',
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      <span>{el.app.updateAvailable}</span>
      <button className="primary icon-btn" onClick={() => void updateServiceWorker(true)}>
        <Icon name="refresh" />
        {el.app.updateReload}
      </button>
      <button className="ghost" onClick={() => setNeedRefresh(false)} aria-label={el.app.updateLater}>
        ✕
      </button>
    </div>
  );
}
