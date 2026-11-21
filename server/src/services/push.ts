/**
 * Web Push: στέλνει την ειδοποίηση στις συσκευές του παραλήπτη, ώστε να εμφανιστεί ως
 * ειδοποίηση του λειτουργικού (Windows/macOS/Android) ακόμα και με κλειστό το app.
 *
 * Κλειδιά VAPID: αν δίνονται VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY από το περιβάλλον,
 * χρησιμοποιούνται αυτά. Αλλιώς δημιουργούνται μία φορά και αποθηκεύονται στη βάση
 * (AppSetting), ώστε η λειτουργία να δουλεύει χωρίς επιπλέον ρύθμιση στο Railway — και
 * να μην αλλάζουν σε κάθε deploy, που θα ακύρωνε όλες τις υπάρχουσες συνδρομές.
 */
import webpush from 'web-push';
import type { PushPayload } from '@metafrasis/shared';
import { prisma } from '../db.js';
import { CLIENT_ORIGIN } from '../config.js';

const PUBLIC_KEY_SETTING = 'vapid.publicKey';
const PRIVATE_KEY_SETTING = 'vapid.privateKey';

/** Πόσο κρατά ο push service του browser μια ειδοποίηση για συσκευή εκτός δικτύου. */
const TTL_SECONDS = 24 * 60 * 60;

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let keysPromise: Promise<VapidKeys> | null = null;

async function loadOrCreateKeys(): Promise<VapidKeys> {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };

  const stored = await prisma.appSetting.findMany({
    where: { key: { in: [PUBLIC_KEY_SETTING, PRIVATE_KEY_SETTING] } },
  });
  const publicKey = stored.find((s) => s.key === PUBLIC_KEY_SETTING)?.value;
  const privateKey = stored.find((s) => s.key === PRIVATE_KEY_SETTING)?.value;
  if (publicKey && privateKey) return { publicKey, privateKey };

  const generated = webpush.generateVAPIDKeys();
  // skipDuplicates: αν δύο instances ξεκινήσουν μαζί, κερδίζει το πρώτο και το δεύτερο
  // ξαναδιαβάζει — έτσι υπάρχει πάντα ένα μόνο ζεύγος κλειδιών.
  await prisma.appSetting.createMany({
    data: [
      { key: PUBLIC_KEY_SETTING, value: generated.publicKey },
      { key: PRIVATE_KEY_SETTING, value: generated.privateKey },
    ],
    skipDuplicates: true,
  });
  const final = await prisma.appSetting.findMany({
    where: { key: { in: [PUBLIC_KEY_SETTING, PRIVATE_KEY_SETTING] } },
  });
  return {
    publicKey: final.find((s) => s.key === PUBLIC_KEY_SETTING)!.value,
    privateKey: final.find((s) => s.key === PRIVATE_KEY_SETTING)!.value,
  };
}

/** Τα κλειδιά φορτώνονται μία φορά ανά διεργασία· μια αποτυχία ξαναδοκιμάζεται την επόμενη φορά. */
export function getVapidKeys(): Promise<VapidKeys> {
  if (!keysPromise) {
    keysPromise = loadOrCreateKeys().catch((error) => {
      keysPromise = null;
      throw error;
    });
  }
  return keysPromise;
}

/**
 * Το "subject" του VAPID: πώς μπορεί ο push service να επικοινωνήσει με τον διαχειριστή.
 * Πρέπει να είναι https: ή mailto: — σε dev το origin είναι http://localhost, οπότε
 * υποχωρούμε σε ένα mailto: ώστε να δουλεύει και τοπικά.
 */
function vapidSubject(): string {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  return CLIENT_ORIGIN.startsWith('https://') ? CLIENT_ORIGIN : 'mailto:admin@localhost';
}

/** Οι push services απαντούν 404/410 όταν η συνδρομή δεν υπάρχει πια (π.χ. ο χρήστης την ανακάλεσε). */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
}

/**
 * Στέλνει σε όλες τις συσκευές των χρηστών. Δεν ρίχνει ποτέ — όπως και το notify(), μια
 * αποτυχημένη ειδοποίηση δεν πρέπει να ακυρώσει την ενέργεια που την προκάλεσε.
 * Επιστρέφει πόσες συσκευές την παρέλαβαν (για τη δοκιμαστική ειδοποίηση).
 */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<number> {
  if (userIds.length === 0) return 0;

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    if (subscriptions.length === 0) return 0;

    const { publicKey, privateKey } = await getVapidKeys();
    const body = JSON.stringify(payload);
    const gone: string[] = [];
    let delivered = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            {
              TTL: TTL_SECONDS,
              urgency: 'normal',
              vapidDetails: { subject: vapidSubject(), publicKey, privateKey },
            },
          );
          delivered += 1;
        } catch (error) {
          if (isGone(error)) gone.push(sub.id);
          else console.error('[metafrasis] αποτυχία αποστολής push:', error);
        }
      }),
    );

    if (gone.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    }
    return delivered;
  } catch (error) {
    console.error('[metafrasis] αποτυχία αποστολής push:', error);
    return 0;
  }
}
