import { z } from 'zod';

/**
 * Ειδοποιήσεις επιφάνειας εργασίας (Web Push). Ο server στέλνει, ο service worker του
 * browser εμφανίζει την ειδοποίηση του λειτουργικού — ακόμα και με κλειστό το app.
 */

/** Ό,τι επιστρέφει το PushSubscription.toJSON() του browser, όσο χρειάζεται ο server. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

/** Το περιεχόμενο που διαβάζει ο service worker στο event "push". */
export interface PushPayload {
  title: string;
  body: string;
  /** Διαδρομή μέσα στο app για κλικ-και-μετάβαση. */
  url: string;
  /** Ειδοποιήσεις με το ίδιο tag αντικαθιστούν η μία την άλλη αντί να στοιβάζονται. */
  tag: string;
}

/**
 * Ετικέτες τύπων ειδοποίησης. Ζουν εδώ ώστε το κουδούνι (client) και η ειδοποίηση του
 * λειτουργικού (server) να λένε ακριβώς το ίδιο πράγμα.
 */
export const NOTIFICATION_LABELS: Record<string, string> = {
  'task.assign': 'Σου ανατέθηκε η εργασία',
  'comment.reply': 'Νέο σχόλιο στο κείμενο',
  'comment.mention': 'Σε ανέφεραν σε σχόλιο',
  'qa.create': 'Νέα αναφορά QA',
  'qa.resolve': 'Επιλύθηκε η αναφορά',
  'file.upload': 'Νέο αρχείο',
  'file.update': 'Ενημερώθηκε το αρχείο',
};
