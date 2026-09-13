import { Router } from 'express';
import type { NotificationView } from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';

/**
 * Σε αντίθεση με όλους τους άλλους routers, αυτός ΔΕΝ φωλιάζει κάτω από
 * /projects/:projectId — ο χρήστης μπορεί να έχει ειδοποιήσεις από πολλά projects
 * ταυτόχρονα, και το κουδούνι πρέπει να δείχνει το συνολικό μη-αναγνωσμένο πλήθος
 * ακόμα και στη λίστα projects, πριν μπει σε κανένα.
 */
export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

const MAX_LIST = 50;

notificationsRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, MAX_LIST);
  const unreadOnly = req.query.unreadOnly === 'true';

  const rows = await prisma.notification.findMany({
    where: { userId: req.userId!, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { project: { select: { name: true } } },
  });

  res.json(
    rows.map(
      (row): NotificationView => ({
        id: row.id,
        projectId: row.projectId,
        projectName: row.project.name,
        type: row.type,
        target: row.target,
        link: row.link,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
  );
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const count = await prisma.notification.count({
    where: { userId: req.userId!, readAt: null },
  });
  res.json({ count });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  // updateMany αντί για update: αν το id δεν ανήκει στον χρήστη, δεν αλλάζει τίποτα
  // αντί να ρίξει — δεν έχει νόημα να αποκαλύπτουμε αν υπάρχει ειδοποίηση άλλου.
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.userId!, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.userId!, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
});
