/**
 * Ειδοποιήσεις ανά μέλος — σε αντίθεση με το logActivity() (κοινό log για όλο το
 * project), αυτές αφορούν έναν συγκεκριμένο παραλήπτη. Καλούνται παράλληλα με το
 * logActivity() στα ίδια σημεία του κώδικα, όχι αντί για αυτό.
 */
import type { NotificationType } from '@metafrasis/shared';
import { prisma } from '../db.js';

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
  }
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
  }
}
