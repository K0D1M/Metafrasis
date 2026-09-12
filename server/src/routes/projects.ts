import { Router } from 'express';
import {
  createProjectSchema,
  Role,
  type ProjectSummary,
  type MemberView,
  type InviteInput,
  inviteSchema,
} from '@metafrasis/shared';
import { randomBytes } from 'node:crypto';
import { ActivityAction } from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireAuth, requireProjectRole } from '../auth.js';
import { projectProgress } from '../services/progress.js';
import { logActivity } from '../services/activity.js';

export const projectsRouter: Router = Router();

projectsRouter.use(requireAuth);

/** Η πρώτη γλώσσα-στόχος είναι αυτή που οδηγεί τις μπάρες προόδου. */
function primaryTarget(targetLanguages: string): string {
  const parsed = JSON.parse(targetLanguages) as string[];
  return parsed[0] ?? 'el';
}

/* ── Λίστα και δημιουργία ──────────────────────────────────────────────────── */

projectsRouter.get('/', async (req, res) => {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: req.userId! },
    include: { project: true },
    orderBy: { joinedAt: 'desc' },
  });

  const summaries: ProjectSummary[] = await Promise.all(
    memberships.map(async (m) => ({
      id: m.project.id,
      name: m.project.name,
      sourceLanguage: m.project.sourceLanguage,
      targetLanguages: JSON.parse(m.project.targetLanguages) as string[],
      role: m.role as Role,
      progress: await projectProgress(m.project.id, primaryTarget(m.project.targetLanguages)),
      createdAt: m.project.createdAt.toISOString(),
    })),
  );

  res.json(summaries);
});

projectsRouter.post('/', async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, sourceLanguage, targetLanguages } = parsed.data;

  if (targetLanguages.includes(sourceLanguage)) {
    res.status(400).json({ error: 'Η γλώσσα-πηγή δεν μπορεί να είναι και γλώσσα-στόχος' });
    return;
  }

  // Ο δημιουργός γίνεται αυτόματα Διαχειριστής.
  const project = await prisma.project.create({
    data: {
      name,
      sourceLanguage,
      targetLanguages: JSON.stringify(targetLanguages),
      members: { create: { userId: req.userId!, role: Role.MANAGER } },
    },
  });

  await logActivity({
    projectId: project.id,
    userId: req.userId!,
    action: ActivityAction.PROJECT_CREATE,
    target: project.name,
  });

  res.status(201).json({
    id: project.id,
    name: project.name,
    sourceLanguage: project.sourceLanguage,
    targetLanguages,
    role: Role.MANAGER,
    progress: { total: 0, translated: 0, percent: 0 },
    createdAt: project.createdAt.toISOString(),
  } satisfies ProjectSummary);
});

/* ── Ένα project ───────────────────────────────────────────────────────────── */

projectsRouter.get('/:projectId', requireProjectRole(), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project) {
    res.status(404).json({ error: 'Το project δεν βρέθηκε' });
    return;
  }

  const targets = JSON.parse(project.targetLanguages) as string[];
  res.json({
    id: project.id,
    name: project.name,
    sourceLanguage: project.sourceLanguage,
    targetLanguages: targets,
    role: req.projectRole,
    activityVisibleToAll: project.activityVisibleToAll,
    progress: await projectProgress(project.id, targets[0] ?? 'el'),
    createdAt: project.createdAt.toISOString(),
  });
});

/* ── Μέλη ──────────────────────────────────────────────────────────────────── */

projectsRouter.get('/:projectId/members', requireProjectRole(), async (req, res) => {
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.projectId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });

  res.json(
    members.map(
      (m): MemberView => ({
        userId: m.user.id,
        username: m.user.username,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role as Role,
        joinedAt: m.joinedAt.toISOString(),
      }),
    ),
  );
});

/** Το username αλλάζει μόνο ο διαχειριστής (απαίτηση προδιαγραφής). */
projectsRouter.patch(
  '/:projectId/members/:userId',
  requireProjectRole({ managerOnly: true }),
  async (req, res) => {
    const { projectId, userId } = req.params;
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : null;
    const role = req.body?.role as Role | undefined;

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: projectId!, userId: userId! } },
    });
    if (!membership) {
      res.status(404).json({ error: 'Το μέλος δεν βρέθηκε' });
      return;
    }

    // Χωρίς αυτόν τον έλεγχο, ο τελευταίος διαχειριστής μπορεί να υποβιβάσει τον εαυτό του
    // και το project μένει χωρίς κανέναν που να μπορεί να το διαχειριστεί.
    if (role === Role.TRANSLATOR && membership.role === Role.MANAGER) {
      const managerCount = await prisma.projectMember.count({
        where: { projectId: projectId!, role: Role.MANAGER },
      });
      if (managerCount <= 1) {
        res.status(400).json({ error: 'Το project πρέπει να έχει τουλάχιστον έναν διαχειριστή' });
        return;
      }
    }

    if (username) {
      if (username.length < 2 || username.length > 40) {
        res.status(400).json({ error: 'Το όνομα χρήστη πρέπει να έχει 2–40 χαρακτήρες' });
        return;
      }
      // Το username είναι μοναδικό στη βάση (χρησιμοποιείται και για σύνδεση).
      const collision = await prisma.user.findUnique({ where: { username } });
      if (collision && collision.id !== userId) {
        res.status(409).json({ error: 'Το όνομα χρήστη χρησιμοποιείται ήδη' });
        return;
      }
      await prisma.user.update({ where: { id: userId! }, data: { username } });
    }

    if (role) {
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: projectId!, userId: userId! } },
        data: { role },
      });
    }

    await logActivity({
      projectId: projectId!,
      userId: req.userId!,
      action: ActivityAction.MEMBER_UPDATE,
      target: username ?? userId!,
    });

    res.status(204).end();
  },
);

projectsRouter.delete(
  '/:projectId/members/:userId',
  requireProjectRole({ managerOnly: true }),
  async (req, res) => {
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

    const removed = await prisma.user.findUnique({ where: { id: userId! } });

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: projectId!, userId: userId! } },
    });

    await logActivity({
      projectId: projectId!,
      userId: req.userId!,
      action: ActivityAction.MEMBER_REMOVE,
      target: removed?.username ?? userId!,
    });

    res.status(204).end();
  },
);

/* ── Προσθήκη μέλους → Δημιουργία Συνδέσμου ────────────────────────────────── */

projectsRouter.post(
  '/:projectId/invites',
  requireProjectRole({ managerOnly: true }),
  async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body satisfies unknown as InviteInput);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
      return;
    }
    const { email, role, message } = parsed.data;
    const projectId = req.params.projectId!;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const already = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: existing.id } },
      });
      if (already) {
        res.status(409).json({ error: 'Ο χρήστης είναι ήδη μέλος του project' });
        return;
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.invite.create({
      data: { projectId, email, role, message, token, createdBy: req.userId!, expiresAt },
    });

    await logActivity({
      projectId,
      userId: req.userId!,
      action: ActivityAction.MEMBER_INVITE,
      target: email,
    });

    // Χωρίς SMTP σε αυτή τη φάση: ο σύνδεσμος επιστρέφεται για αντιγραφή από τον διαχειριστή.
    const origin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
    res.status(201).json({
      url: `${origin}/register?invite=${token}`,
      email,
      role,
      expiresAt: expiresAt.toISOString(),
    });
  },
);
