import { Router } from 'express';
import {
  ActivityAction,
  Role,
  updateSettingsSchema,
  type ActivityView,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { logActivity } from '../services/activity.js';
import { deleteScreenshots } from '../storage.js';

export const activityRouter: Router = Router({ mergeParams: true });

/**
 * Η Δραστηριότητα είναι ορατή στους διαχειριστές. Οι υπόλοιποι τη βλέπουν μόνο αν
 * το έχει επιτρέψει ένας διαχειριστής από τις Ρυθμίσεις.
 */
activityRouter.get('/activity', requireProjectRole(), async (req, res) => {
  const projectId = req.params.projectId!;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: 'Το project δεν βρέθηκε' });
    return;
  }

  if (req.projectRole !== Role.MANAGER && !project.activityVisibleToAll) {
    res.status(403).json({ error: 'Η δραστηριότητα είναι ορατή μόνο στους διαχειριστές' });
    return;
  }

  const rows = await prisma.activity.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    // Πρακτικό όριο: η καρτέλα δείχνει το πρόσφατο ιστορικό, όχι όλη τη ζωή του project.
    take: 200,
    include: { user: { select: { id: true, username: true, avatarUrl: true } } },
  });

  res.json(
    rows.map(
      (row): ActivityView => ({
        id: row.id,
        action: row.action,
        target: row.target,
        createdAt: row.createdAt.toISOString(),
        user: row.user,
      }),
    ),
  );
});

/* ── Ρυθμίσεις ─────────────────────────────────────────────────────────────── */

activityRouter.patch(
  '/settings',
  requireProjectRole({ managerOnly: true }),
  async (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Μη έγκυρες ρυθμίσεις', fields: parsed.error.flatten().fieldErrors });
      return;
    }

    const project = await prisma.project.update({
      where: { id: req.params.projectId },
      data: parsed.data,
    });

    await logActivity({
      projectId: project.id,
      userId: req.userId!,
      action: ActivityAction.SETTINGS_UPDATE,
      target: project.name,
    });

    res.json({
      id: project.id,
      name: project.name,
      activityVisibleToAll: project.activityVisibleToAll,
    });
  },
);

/**
 * Διαγραφή project — μη αναστρέψιμη, γι' αυτό μόνο από διαχειριστή.
 *
 * Το Prisma cascade καθαρίζει τις εγγραφές Screenshot στη βάση, αλλά όχι τα ίδια τα
 * αρχεία στο Supabase Storage — γι' αυτό τα διαγράφουμε ρητά ΠΡΙΝ το cascade delete,
 * όσο ξέρουμε ακόμα ποια είναι.
 */
activityRouter.delete('/', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const screenshots = await prisma.screenshot.findMany({
    where: { projectId: req.params.projectId },
    select: { storedName: true },
  });

  await prisma.project.delete({ where: { id: req.params.projectId } });

  await deleteScreenshots(screenshots.map((s) => s.storedName));

  res.status(204).end();
});
