import { Router } from 'express';
import {
  ActivityAction,
  Role,
  type AdminProjectView,
  type AdminUserView,
} from '@metafrasis/shared';
import { prisma, prismaUnmasked } from '../db.js';
import { projectProgress } from '../services/progress.js';
import { logActivity } from '../services/activity.js';

export const adminRouter: Router = Router();

function primaryTarget(targetLanguages: string): string {
  return (JSON.parse(targetLanguages) as string[])[0] ?? 'el';
}

/* ── Όλα τα projects και τα μέλη τους ─────────────────────────────────────── */

adminRouter.get('/projects', async (_req, res) => {
  const projects = await prismaUnmasked.project.findMany({
    orderBy: { name: 'asc' },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, email: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  const views: AdminProjectView[] = await Promise.all(
    projects.map(async (p) => ({
      id: p.id,
      name: p.name,
      sourceLanguage: p.sourceLanguage,
      targetLanguages: JSON.parse(p.targetLanguages) as string[],
      createdAt: p.createdAt.toISOString(),
      progress: await projectProgress(p.id, primaryTarget(p.targetLanguages)),
      members: p.members.map((m) => ({
        userId: m.user.id,
        username: m.user.username,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role as Role,
        joinedAt: m.joinedAt.toISOString(),
      })),
    })),
  );

  res.json(views);
});

/** Προσθήκη μέλους απευθείας — χωρίς πρόσκληση, αφού ο γενικός διαχειριστής δεν χρειάζεται να προσκληθεί. */
adminRouter.post('/projects/:projectId/members', async (req, res) => {
  const { projectId } = req.params;
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
  const role = req.body?.role as Role | undefined;

  if (!userId || (role !== Role.MANAGER && role !== Role.TRANSLATOR)) {
    res.status(400).json({ error: 'Απαιτούνται userId και έγκυρος ρόλος' });
    return;
  }

  const [project, user] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  if (!project || !user) {
    res.status(404).json({ error: 'Το project ή ο χρήστης δεν βρέθηκε' });
    return;
  }

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: projectId!, userId } },
  });
  if (existing) {
    res.status(409).json({ error: 'Ο χρήστης είναι ήδη μέλος του project' });
    return;
  }

  await prisma.projectMember.create({ data: { projectId: projectId!, userId, role } });

  await logActivity({
    projectId: projectId!,
    userId: req.userId!,
    action: ActivityAction.MEMBER_JOIN,
    target: user.username,
  });

  res.status(201).end();
});

/** Αλλαγή ρόλου — παράλληλο μονοπάτι με το PATCH .../members/:userId του project, με requireGlobalAdmin αντί για requireProjectRole. */
adminRouter.patch('/projects/:projectId/members/:userId', async (req, res) => {
  const { projectId, userId } = req.params;
  const role = req.body?.role as Role | undefined;
  if (role !== Role.MANAGER && role !== Role.TRANSLATOR) {
    res.status(400).json({ error: 'Μη έγκυρος ρόλος' });
    return;
  }

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: projectId!, userId: userId! } },
  });
  if (!membership) {
    res.status(404).json({ error: 'Το μέλος δεν βρέθηκε' });
    return;
  }

  if (role === Role.TRANSLATOR && membership.role === Role.MANAGER) {
    const managerCount = await prisma.projectMember.count({
      where: { projectId: projectId!, role: Role.MANAGER },
    });
    if (managerCount <= 1) {
      res.status(400).json({ error: 'Το project πρέπει να έχει τουλάχιστον έναν διαχειριστή' });
      return;
    }
  }

  await prisma.projectMember.update({
    where: { projectId_userId: { projectId: projectId!, userId: userId! } },
    data: { role },
  });

  res.status(204).end();
});

adminRouter.delete('/projects/:projectId/members/:userId', async (req, res) => {
  const { projectId, userId } = req.params;

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: projectId!, userId: userId! } },
  });
  if (!membership) {
    res.status(404).json({ error: 'Το μέλος δεν βρέθηκε' });
    return;
  }

  if (membership.role === Role.MANAGER) {
    const managerCount = await prisma.projectMember.count({
      where: { projectId: projectId!, role: Role.MANAGER },
    });
    if (managerCount <= 1) {
      res.status(400).json({ error: 'Το project πρέπει να έχει τουλάχιστον έναν διαχειριστή' });
      return;
    }
  }

  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId: projectId!, userId: userId! } },
  });

  res.status(204).end();
});

/* ── Καθολικός κατάλογος χρηστών ──────────────────────────────────────────── */

adminRouter.get('/users', async (_req, res) => {
  // prismaUnmasked: ο γενικός διαχειριστής πρέπει να βλέπει το πραγματικό username,
  // ακόμα και για απενεργοποιημένους λογαριασμούς — αλλιώς δεν μπορεί να τους εντοπίσει
  // για επαναφορά.
  const users = await prismaUnmasked.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      memberships: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  const views: AdminUserView[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    avatarUrl: u.avatarUrl,
    isAdmin: u.isAdmin,
    deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    memberships: u.memberships.map((m) => ({
      projectId: m.project.id,
      projectName: m.project.name,
      role: m.role as Role,
    })),
  }));

  res.json(views);
});

adminRouter.patch('/users/:userId/deactivate', async (req, res) => {
  const { userId } = req.params;
  if (userId === req.userId) {
    res.status(400).json({ error: 'Δεν μπορείς να απενεργοποιήσεις τον δικό σου λογαριασμό' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: 'Ο χρήστης δεν βρέθηκε' });
    return;
  }

  await prisma.user.update({ where: { id: userId! }, data: { deactivatedAt: new Date() } });
  res.status(204).end();
});

adminRouter.patch('/users/:userId/reactivate', async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: 'Ο χρήστης δεν βρέθηκε' });
    return;
  }

  await prisma.user.update({ where: { id: userId! }, data: { deactivatedAt: null } });
  res.status(204).end();
});
