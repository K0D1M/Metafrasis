/**
 * Ειδοποιήσεις ανά μέλος — σε αντίθεση με το logActivity() (κοινό log για όλο το
 * project), αυτές αφορούν έναν συγκεκριμένο παραλήπτη. Καλούνται παράλληλα με το
 * logActivity() στα ίδια σημεία του κώδικα, όχι αντί για αυτό.
 */
import { NOTIFICATION_LABELS, type NotificationType, type PushPayload } from '@metafrasis/shared';
import { prisma } from '../db.js';
import { sendPush } from './push.js';

interface NotifyParams {
  userId: string;
  projectId: string;
  type: NotificationType;
  target?: string | null;
  link?: string | null;
  /** Ο χρήστης που προκάλεσε το γεγονός — ποτέ δεν ειδοποιείται για τη δική του ενέργεια. */
  actorId?: string;
}

/**
 * Γράφει μια ειδοποίηση. Δεν ρίχνει ποτέ — μια αποτυχημένη ειδοποίηση δεν πρέπει να
 * ακυρώσει την ενέργεια που μόλις πέτυχε (ίδια λογική με logActivity).
 */
export async function notify(params: NotifyParams): Promise<void> {
  if (params.actorId && params.userId === params.actorId) return;

  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        projectId: params.projectId,
        type: params.type,
        target: params.target ?? null,
        link: params.link ?? null,
      },
    });
  } catch (error) {
    console.error('[metafrasis] αποτυχία δημιουργίας ειδοποίησης:', error);
    return;
  }
  pushInBackground([params.userId], params);
}

/** Ίδια ειδοποίηση σε πολλούς παραλήπτες — π.χ. όλοι οι διαχειριστές, ή όλα τα μέλη. */
export async function notifyMany(
  userIds: string[],
  params: Omit<NotifyParams, 'userId'>,
): Promise<void> {
  const recipients = [...new Set(userIds)].filter((id) => id !== params.actorId);
  if (recipients.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        projectId: params.projectId,
        type: params.type,
        target: params.target ?? null,
        link: params.link ?? null,
      })),
    });
  } catch (error) {
    console.error('[metafrasis] αποτυχία μαζικής δημιουργίας ειδοποιήσεων:', error);
    return;
  }
  pushInBackground(recipients, params);
}

/**
 * Ίδιο κείμενο με το κουδούνι: τίτλος ο τύπος, σώμα το αντικείμενο και το project.
 * Το tag ενώνει επαναλαμβανόμενα γεγονότα για το ίδιο σημείο σε μία ειδοποίηση.
 */
async function buildPayload(params: Omit<NotifyParams, 'userId'>): Promise<PushPayload> {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { name: true },
  });
  const parts = [params.target ? `«${params.target}»` : null, project?.name].filter(Boolean);
  return {
    title: NOTIFICATION_LABELS[params.type] ?? params.type,
    body: parts.join(' · '),
    url: params.link ?? '/',
    tag: `${params.type}:${params.link ?? params.target ?? params.projectId}`,
  };
}

/**
 * Η αποστολή push γίνεται χωρίς await: η απάντηση στον χρήστη που έκανε την ενέργεια
 * δεν περιμένει τους push services των παραληπτών. Τα σφάλματα καταγράφονται μέσα στο sendPush.
 */
function pushInBackground(userIds: string[], params: Omit<NotifyParams, 'userId'>): void {
  void buildPayload(params)
    .then((payload) => sendPush(userIds, payload))
    .catch((error) => console.error('[metafrasis] αποτυχία αποστολής push:', error));
}
