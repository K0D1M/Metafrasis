import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';

/**
 * Ειδοποιήσεις επιφάνειας εργασίας μέσω Web Push. Η άδεια του browser ζητείται ΜΟΝΟ
 * όταν ο χρήστης πατήσει ρητά «Ενεργοποίηση» — ποτέ αυτόματα στη φόρτωση της σελίδας.
 */

export type DesktopNotificationState =
  /** Ο browser δεν υποστηρίζει Web Push (ή το iOS Safari εκτός εγκατεστημένου PWA). */
  | 'unsupported'
  /** Ο χρήστης (ή η πολιτική του browser) έχει μπλοκάρει τις ειδοποιήσεις. */
  | 'denied'
  | 'off'
  | 'on';

export const DESKTOP_NOTIFICATIONS_EVENT = 'metafrasis:desktop-notifications';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone/iPad: το Web Push δουλεύει μόνο αφού προστεθεί το app στην οθόνη αφετηρίας. */
export function isIosOutsidePwa(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}

/** Το pushManager χρειάζεται το κλειδί ως Uint8Array, ενώ ο server το δίνει base64url. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  // Σε dev (vite) δεν υπάρχει service worker· το getRegistration επιστρέφει undefined.
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function getDesktopNotificationState(): Promise<DesktopNotificationState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const subscription = await reg.pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

function announce() {
  window.dispatchEvent(new Event(DESKTOP_NOTIFICATIONS_EVENT));
}

/** Πρέπει να καλείται μέσα από κλικ του χρήστη — αλλιώς οι browsers απορρίπτουν το αίτημα άδειας. */
export async function enableDesktopNotifications(): Promise<DesktopNotificationState> {
  if (!isPushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    announce();
    return permission === 'denied' ? 'denied' : 'off';
  }

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>('/push/public-key');
  const key = base64UrlToBytes(publicKey);

  let subscription = await reg.pushManager.getSubscription();
  // Παλιά συνδρομή με άλλο κλειδί VAPID (π.χ. μετά από αλλαγή κλειδιών) δεν θα δούλευε.
  const existingKey = subscription?.options.applicationServerKey;
  if (subscription && existingKey && !sameBytes(new Uint8Array(existingKey), key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  await api.post('/push/subscriptions', subscription.toJSON());
  announce();
  return 'on';
}

export async function disableDesktopNotifications(): Promise<DesktopNotificationState> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    // Πρώτα ο server (όσο υπάρχει ακόμα συνεδρία), μετά ο browser.
    await api.delete(`/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`).catch(() => {});
    await subscription.unsubscribe().catch(() => false);
  }
  announce();
  return getDesktopNotificationState();
}

export async function sendTestNotification(): Promise<number> {
  const { delivered } = await api.post<{ delivered: number }>('/push/test');
  return delivered;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Η τρέχουσα κατάσταση, ενημερωμένη όταν αλλάξει από οπουδήποτε στο app. */
export function useDesktopNotificationState(): [DesktopNotificationState | null, (s: DesktopNotificationState) => void] {
  const [state, setState] = useState<DesktopNotificationState | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getDesktopNotificationState()
        .then((s) => !cancelled && setState(s))
        .catch(() => !cancelled && setState('unsupported'));
    };
    refresh();
    window.addEventListener(DESKTOP_NOTIFICATIONS_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(DESKTOP_NOTIFICATIONS_EVENT, refresh);
    };
  }, []);
  return [state, setState];
}

/**
 * Κλικ σε ειδοποίηση με ήδη ανοιχτό το app: ο service worker εστιάζει το παράθυρο και
 * ζητά μετάβαση εδώ, ώστε να γίνει μέσα από τον router χωρίς πλήρη επαναφόρτωση.
 */
export function PushNavigationListener() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== 'metafrasis:navigate' || !data.url) return;
      const url = new URL(data.url, window.location.origin);
      if (url.origin === window.location.origin) navigate(url.pathname + url.search + url.hash);
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
  return null;
}
