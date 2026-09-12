/**
 * Καταγραφή ενεργειών για την καρτέλα Δραστηριότητα.
 */
import type { ActivityAction } from '@metafrasis/shared';
import { prisma } from '../db.js';

/**
 * Γράφει μια εγγραφή δραστηριότητας.
 *
 * Δεν ρίχνει ποτέ: η καταγραφή είναι δευτερεύουσα και δεν πρέπει να ακυρώσει την
 * ενέργεια που μόλις πέτυχε (π.χ. ένα ανέβασμα αρχείου).
 */
export async function logActivity(params: {
  projectId: string;
  userId: string;
  action: ActivityAction;
  target?: string | null;
}): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        projectId: params.projectId,
        userId: params.userId,
        action: params.action,
        target: params.target ?? null,
      },
    });
  } catch (error) {
    console.error('[metafrasis] αποτυχία καταγραφής δραστηριότητας:', error);
  }
}
