import { Router } from 'express';
import {
  ActivityAction,
  createQaReportSchema,
  NotificationType,
  QaStatus,
  Role,
  type QaReportView,
  type QaSeverity,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { logActivity } from '../services/activity.js';
import { notify, notifyMany } from '../services/notify.js';

export const qaRouter: Router = Router({ mergeParams: true });

const qaInclude = {
  author: { select: { id: true, username: true, avatarUrl: true } },
  resolvedBy: { select: { id: true, username: true } },
  string: { select: { id: true, key: true, file: { select: { name: true } } } },
} as const;

type QaRow = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  author: { id: string; username: string; avatarUrl: string | null };
  resolvedBy: { id: string; username: string } | null;
  string: { id: string; key: string; file: { name: string } } | null;
};

function toView(row: QaRow): QaReportView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity as QaSeverity,
    status: row.status as QaStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    author: row.author,
    resolvedBy: row.resolvedBy,
    string: row.string
      ? { id: row.string.id, key: row.string.key, fileName: row.string.file.name }
      : null,
  };
}

qaRouter.get('/', requireProjectRole(), async (req, res) => {
  const rows = await prisma.qaReport.findMany({
    where: { projectId: req.params.projectId },
    // Ανοιχτές πρώτα, μετά οι πιο πρόσφατες.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: qaInclude,
  });
  res.json(rows.map(toView));
});

qaRouter.post('/', requireProjectRole(), async (req, res) => {
  const parsed = createQaReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
    return;
  }
  const { title, description, severity, stringId } = parsed.data;
  const projectId = req.params.projectId!;

  // Αν δηλώθηκε κείμενο, πρέπει να ανήκει στο project.
  if (stringId) {
    const exists = await prisma.sourceString.findFirst({
      where: { id: stringId, file: { projectId } },
    });
    if (!exists) {
      res.status(400).json({ error: 'Το κείμενο δεν βρέθηκε στο project' });
      return;
    }
  }

  const report = await prisma.qaReport.create({
    data: {
      projectId,
      title,
      description,
      severity,
      stringId: stringId ?? null,
      authorId: req.userId!,
    },
    include: qaInclude,
  });

  await logActivity({
    projectId,
    userId: req.userId!,
    action: ActivityAction.QA_CREATE,
    target: title,
  });

  // Ειδοποιούνται οι διαχειριστές — αυτοί ενεργούν στις αναφορές, όχι όλα τα μέλη.
  const managers = await prisma.projectMember.findMany({
    where: { projectId, role: Role.MANAGER },
    select: { userId: true },
  });
  await notifyMany(managers.map((m) => m.userId), {
    projectId,
    type: NotificationType.QA_CREATE,
    target: title,
    link: `/projects/${projectId}?tab=qa`,
    actorId: req.userId!,
  });

  res.status(201).json(toView(report));
});

/** Επίλυση ή επαναφορά αναφοράς. */
qaRouter.patch('/:reportId', requireProjectRole(), async (req, res) => {
  const report = await prisma.qaReport.findFirst({
    where: { id: req.params.reportId, projectId: req.params.projectId },
  });
  if (!report) {
    res.status(404).json({ error: 'Η αναφορά δεν βρέθηκε' });
    return;
  }

  const resolving = req.body?.status === QaStatus.RESOLVED;

  const updated = await prisma.qaReport.update({
    where: { id: report.id },
    data: resolving
      ? { status: QaStatus.RESOLVED, resolvedById: req.userId!, resolvedAt: new Date() }
      : { status: QaStatus.OPEN, resolvedById: null, resolvedAt: null },
    include: qaInclude,
  });

  if (resolving) {
    await logActivity({
      projectId: req.params.projectId!,
      userId: req.userId!,
      action: ActivityAction.QA_RESOLVE,
      target: report.title,
    });

    await notify({
      userId: report.authorId,
      projectId: req.params.projectId!,
      type: NotificationType.QA_RESOLVE,
      target: report.title,
      link: `/projects/${req.params.projectId}?tab=qa`,
      actorId: req.userId!,
    });
  }

  res.json(toView(updated));
});

qaRouter.delete('/:reportId', requireProjectRole(), async (req, res) => {
  const report = await prisma.qaReport.findFirst({
    where: { id: req.params.reportId, projectId: req.params.projectId },
  });
  if (!report) {
    res.status(404).json({ error: 'Η αναφορά δεν βρέθηκε' });
    return;
  }
  if (report.authorId !== req.userId && req.projectRole !== Role.MANAGER) {
    res.status(403).json({ error: 'Μπορείς να διαγράψεις μόνο τις δικές σου αναφορές' });
    return;
  }
  await prisma.qaReport.delete({ where: { id: report.id } });
  res.status(204).end();
});
