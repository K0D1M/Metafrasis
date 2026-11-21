/*
 * Ειδοποιήσεις επιφάνειας εργασίας (Web Push). Φορτώνεται μέσα στον service worker
 * που παράγει το vite-plugin-pwa (workbox.importScripts στο vite.config.ts).
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Μετάφρασις';
  const url = payload.url || '/';

  event.waitUntil(
    (async () => {
      // Τα ανοιχτά παράθυρα ανανεώνουν αμέσως το κουδούνι, αντί να περιμένουν το επόμενο poll.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'metafrasis:notification' });

      await self.registration.showNotification(title, {
        body: payload.body || '',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.tag,
        // Ίδιο tag = ίδιο γεγονός: ενημερώνει την υπάρχουσα ειδοποίηση, αλλά ξαναειδοποιεί.
        renotify: Boolean(payload.tag),
        lang: 'el',
        data: { url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Προτιμάμε ένα ήδη ανοιχτό παράθυρο του app — δεν ανοίγουμε νέο σε κάθε κλικ.
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing && existing.url !== target) {
          existing.postMessage({ type: 'metafrasis:navigate', url: target });
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Ο browser μπορεί να ανανεώσει μόνος του τη συνδρομή (λήξη κλειδιών)· την ξαναστέλνουμε.
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options) return;
  event.waitUntil(
    (async () => {
      const subscription = await self.registration.pushManager.subscribe(options);
      await fetch('/api/push/subscriptions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
