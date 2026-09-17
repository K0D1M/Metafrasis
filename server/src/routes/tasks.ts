import { Router } from 'express';
import {
  ActivityAction,
  createTaskSchema,
  createCommentSchema,
  NotificationType,
  Role,
  TaskStatus,
  extractMentions,
  type TaskView,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { logActivity } from '../services/activity.js';
import { notify, notifyMany } from '../services/notify.js';

export const tasksRouter: Router = Router({ mergeParams: true });

const taskInclude = {
  assignee: { select: { id: true, username: true, avatarUrl: true } },
  createdBy: { select: { id: true, username: true } },
  files: { include: { file: { select: { id: true, name: true } } } },
  comments: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  },
} as const;

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  assignee: { id: string; username: string; avatarUrl: string | null };
  createdBy: { id: string; username: string };
  files: Array<{ file: { id: string; name: string } }>;
  comments: Array<{
    id: string;
    body: string;
    createdAt: Date;
    author: { id: string; username: string; avatarUrl: string | null };
  }>;
};

function toView(row: TaskRow): TaskView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    assignee: row.assignee,
    createdBy: row.createdBy,
    files: row.files.map((f) => f.file),
    comments: row.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
    })),
  };
}

/**
 * Ο Μεταφραστής βλέπει μόνο τις δικές του εργασίες· ο Διαχειριστής όλες, γιατί
 * χωρίς αυτό δεν θα μπορούσε να παρακολουθήσει όσα ανέθεσε.
 */
tasksRouter.get('/', requireProjectRole(), async (req, res) => {
  const rows = await prisma.task.findMany({
    where: {
      projectId: req.params.projectId,
      ...(req.projectRole === Role.MANAGER ? {} : { assigneeId: req.userId! }),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: taskInclude,
  });
  res.json(rows.map(toView));
});

tasksRouter.post('/', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
    return;
  }
  const { title, description, assigneeId, fileIds } = parsed.data;
  const projectId = req.params.projectId!;

  // Η ανάθεση έχει νόημα μόνο σε μέλος του project.
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: assigneeId } },
  });
  if (!membership) {
    res.status(400).json({ error: 'Ο παραλήπτης δεν είναι μέλος του project' });
    return;
  }

  // Τα αρχεία πρέπει να ανήκουν στο ίδιο project.
  const validFiles = fileIds.length
    ? await prisma.sourceFile.findMany({
        where: { id: { in: fileIds }, projectId },
        select: { id: true },
      })
    : [];

  const task = await prisma.task.create({
    data: {
      projectId,
      title,
      description: description ?? null,
      assigneeId,
      createdById: req.userId!,
      files: { create: validFiles.map((f) => ({ fileId: f.id })) },
    },
    include: taskInclude,
  });

  await logActivity({
    projectId,
    userId: req.userId!,
    action: ActivityAction.TASK_CREATE,
    target: title,
  });

  await notify({
    userId: assigneeId,
    projectId,
    type: NotificationType.TASK_ASSIGN,
    target: title,
    link: `/projects/${projectId}?tab=tasks`,
    actorId: req.userId!,
  });

  res.status(201).json(toView(task));
});

/** Ο παραλήπτης ή ένας διαχειριστής μπορεί να κλείσει μια εργασία. */
tasksRouter.patch('/:taskId', requireProjectRole(), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
  });
  if (!task) {
    res.status(404).json({ error: 'Η εργασία δεν βρέθηκε' });
    return;
  }
  if (task.assigneeId !== req.userId && req.projectRole !== Role.MANAGER) {
    res.status(403).json({ error: 'Μόνο ο παραλήπτης ή ο διαχειριστής αλλάζει την εργασία' });
    return;
  }

  const status = req.body?.status === TaskStatus.DONE ? TaskStatus.DONE : TaskStatus.OPEN;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status, completedAt: status === TaskStatus.DONE ? new Date() : null },
    include: taskInclude,
  });

  if (status === TaskStatus.DONE) {
    await logActivity({
      projectId: req.params.projectId!,
      userId: req.userId!,
      action: ActivityAction.TASK_COMPLETE,
      target: task.title,
    });
  }

  res.json(toView(updated));
});

tasksRouter.delete('/:taskId', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
  });
  if (!task) {
    res.status(404).json({ error: 'Η εργασία δεν βρέθηκε' });
    return;
  }
  await prisma.task.delete({ where: { id: task.id } });
  res.status(204).end();
});

/* ── Σχόλια εργασιών ───────────────────────────────────────────────────────── */

tasksRouter.post('/:taskId/comments', requireProjectRole(), async (req, res) => {
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρο σχόλιο' });
    return;
  }

  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
  });
  if (!task) {
    res.status(404).json({ error: 'Η εργασία δεν βρέθηκε' });
    return;
  }
  // Ένας μεταφραστής δεν σχολιάζει εργασία που δεν του ανήκει και δεν βλέπει.
  if (task.assigneeId !== req.userId && req.projectRole !== Role.MANAGER) {
    res.status(403).json({ error: 'Δεν έχεις πρόσβαση σε αυτή την εργασία' });
    return;
  }

  const comment = await prisma.taskComment.create({
    data: { taskId: task.id, authorId: req.userId!, body: parsed.data.body },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  });

  // @αναφορές: πρώτη φορά που αυτό το route στέλνει ειδοποίηση — τα σχόλια εργασιών
  // δεν είχαν καθόλου ειδοποιήσεις μέχρι τώρα (μόνο η ανάθεση εργασίας έχει).
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.projectId! },
    include: { user: { select: { id: true, username: true } } },
  });
  const mentionedUsernames = extractMentions(
    parsed.data.body,
    new Set(members.map((m) => m.user.username)),
  );
  const mentionedUserIds = members
    .filter((m) => mentionedUsernames.includes(m.user.username))
    .map((m) => m.user.id);
  if (mentionedUserIds.length > 0) {
    await notifyMany(mentionedUserIds, {
      projectId: req.params.projectId!,
      type: NotificationType.COMMENT_MENTION,
      target: task.title,
      link: `/projects/${req.params.projectId}?tab=tasks`,
      actorId: req.userId!,
    });
  }

  res.status(201).json({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    author: comment.author,
  });
});
