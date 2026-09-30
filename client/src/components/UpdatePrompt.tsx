import { useRegisterSW } from 'virtual:pwa-register/react';
import { el } from '../i18n/el.js';

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
    <div role="status" aria-labelledby="update-title" aria-describedby="update-desc" className="update-prompt">
      <button
        type="button"
        className="ghost update-prompt-close"
        onClick={() => setNeedRefresh(false)}
        aria-label={el.app.updateLater}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="update-prompt-badge">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
          <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M3 21v-5h5" />
        </svg>
      </div>
      <div className="update-prompt-text">
        <div id="update-title" className="update-prompt-title">{el.app.updateAvailable}</div>
        <div id="update-desc" className="muted">{el.app.updateSafe}</div>
      </div>
      <button type="button" className="primary icon-btn update-prompt-reload" onClick={() => void updateServiceWorker(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
        {el.app.updateReload}
      </button>
    </div>
  );
}
