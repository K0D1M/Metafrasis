import { Router, type Response } from 'express';
import multer from 'multer';
import {
  createFolderSchema,
  renameFolderSchema,
  moveFileSchema,
  type FolderNode,
  type SourceFileSummary,
} from '@metafrasis/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { parseJsonUpload, planIngest } from '../services/ingest.js';
import { startJob, updateJob, finishJob, getJobsForProject } from '../services/uploadJobs.js';
import { progressByFile } from '../services/progress.js';
import { adoptPretranslated } from '../services/pretranslated.js';
import { flatten, unflatten, type JsonValue } from '../services/jsonFlatten.js';
import { logActivity } from '../services/activity.js';
import { notifyMany } from '../services/notify.js';
import { attachmentHeader } from '../services/contentDisposition.js';
import { ActivityAction, NotificationType } from '@metafrasis/shared';

export const filesRouter: Router = Router({ mergeParams: true });

/** Στη μνήμη: τα αρχεία JSON είναι μικρά και αποθηκεύονται στη βάση, όχι στον δίσκο. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function primaryTarget(targetLanguages: string): string {
  return (JSON.parse(targetLanguages) as string[])[0] ?? 'el';
}

/* ── Φάκελοι ───────────────────────────────────────────────────────────────── */

filesRouter.post('/folders', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρο όνομα φακέλου' });
    return;
  }

  const folder = await prisma.folder.create({
    data: {
      projectId: req.params.projectId!,
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? null,
    },
  });

  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.FOLDER_CREATE,
    target: folder.name,
  });

  res.status(201).json({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
  } satisfies FolderNode);
});

filesRouter.patch('/folders/:folderId', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const parsed = renameFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρο όνομα φακέλου' });
    return;
  }
  const folder = await prisma.folder.findFirst({
    where: { id: req.params.folderId, projectId: req.params.projectId },
  });
  if (!folder) {
    res.status(404).json({ error: 'Ο φάκελος δεν βρέθηκε' });
    return;
  }

  const updated = await prisma.folder.update({ where: { id: folder.id }, data: { name: parsed.data.name } });
  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.FOLDER_RENAME,
    target: `${folder.name} → ${updated.name}`,
  });
  res.json({ id: updated.id, name: updated.name, parentId: updated.parentId } satisfies FolderNode);
});

/** Διαγραφή φακέλου: τα αρχεία του ΔΕΝ σβήνονται — πάνε στο «Χωρίς φάκελο» (onDelete: SetNull). */
filesRouter.delete('/folders/:folderId', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const folder = await prisma.folder.findFirst({
    where: { id: req.params.folderId, projectId: req.params.projectId },
  });
  if (!folder) {
    res.status(404).json({ error: 'Ο φάκελος δεν βρέθηκε' });
    return;
  }

  await prisma.folder.delete({ where: { id: folder.id } });
  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.FOLDER_DELETE,
    target: folder.name,
  });
  res.status(204).end();
});

/** Μετακίνηση αρχείου σε άλλο φάκελο (ή στο «Χωρίς φάκελο» με folderId: null). */
filesRouter.patch('/:fileId/move', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const parsed = moveFileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρος φάκελος' });
    return;
  }
  const projectId = req.params.projectId!;
  const file = await prisma.sourceFile.findFirst({ where: { id: req.params.fileId, projectId } });
  if (!file) {
    res.status(404).json({ error: 'Το αρχείο δεν βρέθηκε' });
    return;
  }
  const { folderId } = parsed.data;
  const target = folderId
    ? await prisma.folder.findFirst({ where: { id: folderId, projectId } })
    : null;
  if (folderId && !target) {
    res.status(404).json({ error: 'Ο φάκελος δεν βρέθηκε' });
    return;
  }

  await prisma.sourceFile.update({ where: { id: file.id }, data: { folderId } });
  await logActivity({
    projectId,
    userId: req.userId!,
    action: ActivityAction.FILE_MOVE,
    target: `${file.name} → ${target?.name ?? 'Χωρίς φάκελο'}`,
  });
  res.status(204).end();
});

/* ── Περιεχόμενα της καρτέλας Πηγές ────────────────────────────────────────── */

filesRouter.get('/', requireProjectRole(), async (req, res) => {
  const projectId = req.params.projectId!;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: 'Το project δεν βρέθηκε' });
    return;
  }

  const [folders, files, progress] = await Promise.all([
    prisma.folder.findMany({ where: { projectId }, orderBy: { name: 'asc' } }),
    prisma.sourceFile.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      include: {
        // Τα κείμενα που λείπουν από την τρέχουσα αναθεώρηση δεν μετρούν στη στήλη "Strings".
        _count: { select: { strings: { where: { removed: false } } } },
        versions: {
          orderBy: { revision: 'desc' },
          take: 1,
          include: { uploader: { select: { id: true, username: true } } },
        },
      },
    }),
    progressByFile(projectId, primaryTarget(project.targetLanguages)),
  ]);

  res.json({
    folders: folders.map(
      (f): FolderNode => ({ id: f.id, name: f.name, parentId: f.parentId }),
    ),
    files: files.map(
      (f): SourceFileSummary => ({
        id: f.id,
        name: f.name,
        folderId: f.folderId,
        stringCount: f._count.strings,
        revision: f.versions[0]?.revision ?? 0,
        progress: progress.get(f.id) ?? { total: 0, translated: 0, percent: 0 },
        updatedAt: (f.versions[0]?.uploadedAt ?? f.createdAt).toISOString(),
        updatedBy: f.versions[0]?.uploader ?? null,
      }),
    ),
  });
});

/* ── Προσθήκη Αρχείου και Ενημέρωση ────────────────────────────────────────── */

export type IngestStage = 'parsing' | 'diffing' | 'saving';

/** Ποσοστό συνολικής προόδου ανά στάδιο· η αποθήκευση γεμίζει το διάστημα 30–90 σταδιακά. */
const PROGRESS = { parsing: 10, diffing: 25, savingStart: 30, savingEnd: 90, adopting: 95 } as const;

/** Γραμμές ανά ερώτημα: αρκετά μεγάλο για λίγα round trips, αρκετά μικρό για τακτική πρόοδο
 * και για το όριο 32.767 παραμέτρων του Postgres (έως 4 παράμετροι ανά γραμμή). */
const WRITE_CHUNK = 1000;

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += WRITE_CHUNK) result.push(items.slice(i, i + WRITE_CHUNK));
  return result;
}

/** Κοινή διαδρομή για πρώτο ανέβασμα και για Ενημέρωση υπάρχοντος αρχείου. */
async function ingestUpload(params: {
  projectId: string;
  fileId: string | null;
  folderId: string | null;
  name: string;
  content: JsonValue;
  userId: string;
  onProgress?: (stage: IngestStage, percent: number) => void;
}): Promise<{ fileId: string; revision: number; added: number; changed: number; removed: number }> {
  const { projectId, folderId, name, content, userId, onProgress } = params;

  const file =
    params.fileId !== null
      ? await prisma.sourceFile.findUnique({ where: { id: params.fileId } })
      : await prisma.sourceFile.create({ data: { projectId, folderId, name } });

  if (!file) throw new Error('Το αρχείο δεν βρέθηκε');

  const existing = await prisma.sourceString.findMany({
    where: { fileId: file.id },
    select: { key: true, sourceText: true, removed: true, order: true },
  });

  onProgress?.('diffing', PROGRESS.diffing);
  const plan = planIngest(
    content,
    existing.map((s) => ({ key: s.key, sourceText: s.sourceText })),
    new Set(existing.filter((s) => s.removed).map((s) => s.key)),
  );

  // Ένα αμετάβλητο κείμενο χρειάζεται εγγραφή μόνο αν άλλαξε θέση ή επανέρχεται από
  // removed — αλλιώς η Ενημέρωση ενός αρχείου 20.000 κειμένων θα τα ξανάγραφε όλα.
  const existingByKey = new Map(existing.map((s) => [s.key, s]));
  const moved = plan.unchanged.filter((u) => {
    const prior = existingByKey.get(u.key);
    return !prior || prior.order !== u.order || prior.removed;
  });

  const lastVersion = await prisma.fileVersion.findFirst({
    where: { fileId: file.id },
    orderBy: { revision: 'desc' },
  });
  const revision = (lastVersion?.revision ?? 0) + 1;

  const addedChunks = chunks(plan.added);
  const changedChunks = chunks(plan.changed);
  const movedChunks = chunks(moved);
  const removedChunks = chunks(plan.removed);
  const totalSteps =
    1 + addedChunks.length + changedChunks.length + movedChunks.length + removedChunks.length;
  let doneSteps = 0;
  const step = () => {
    doneSteps += 1;
    const span = PROGRESS.savingEnd - PROGRESS.savingStart;
    onProgress?.('saving', Math.round(PROGRESS.savingStart + (span * doneSteps) / totalSteps));
  };

  onProgress?.('saving', PROGRESS.savingStart);
  // Μία συναλλαγή για όλη την εισαγωγή: αν αποτύχει κάτι στη μέση, δεν μένει μισή αναθεώρηση.
  await prisma.$transaction(
    async (tx) => {
      await tx.fileVersion.create({
        data: { fileId: file.id, revision, uploadedBy: userId, rawJson: JSON.stringify(content) },
      });
      step();

      for (const chunk of addedChunks) {
        await tx.sourceString.createMany({
          data: chunk.map((a) => ({ fileId: file.id, key: a.key, sourceText: a.sourceText, order: a.order })),
        });
        step();
      }

      // Το πρωτότυπο άλλαξε: κρατάμε τη μετάφραση αλλά τη σημαιοδοτούμε για έλεγχο.
      for (const chunk of changedChunks) {
        const rows = Prisma.join(chunk.map((c) => Prisma.sql`(${c.key}, ${c.sourceText}, ${c.order}::int)`));
        await tx.$executeRaw`
          UPDATE "SourceString" AS s
          SET "sourceText" = v.text, "order" = v.ord, "needsReview" = true, removed = false
          FROM (VALUES ${rows}) AS v(key, text, ord)
          WHERE s."fileId" = ${file.id} AND s.key = v.key`;
        step();
      }

      for (const chunk of movedChunks) {
        const rows = Prisma.join(chunk.map((u) => Prisma.sql`(${u.key}, ${u.order}::int)`));
        await tx.$executeRaw`
          UPDATE "SourceString" AS s
          SET "order" = v.ord, removed = false
          FROM (VALUES ${rows}) AS v(key, ord)
          WHERE s."fileId" = ${file.id} AND s.key = v.key`;
        step();
      }

      // Σημαιοδότηση, ποτέ διαγραφή: το κλειδί μπορεί να επανέλθει με τη μετάφρασή του.
      for (const chunk of removedChunks) {
        await tx.sourceString.updateMany({
          where: { fileId: file.id, key: { in: chunk } },
          data: { removed: true },
        });
        step();
      }
    },
    // Ένα μεγάλο αρχείο χρειάζεται πολύ περισσότερο από το προεπιλεγμένο όριο των 5s.
    { maxWait: 10_000, timeout: 10 * 60_000 },
  );

  onProgress?.('saving', PROGRESS.adopting);
  // Ένα ολοκληρωμένο αρχείο παύει να είναι μόλις μια Ενημέρωση φέρει νέα ή αλλαγμένα κείμενα.
  let completed = file.completed;
  if (completed && (plan.added.length > 0 || plan.changed.length > 0)) {
    await prisma.sourceFile.update({ where: { id: file.id }, data: { completed: false } });
    completed = false;
  }
  // Όσο είναι ολοκληρωμένο δεν χρειάζονται μεταφράσεις — ούτε αποδίδονται σε κάποιον.
  if (!completed) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { targetLanguages: true },
    });
    for (const language of JSON.parse(project?.targetLanguages ?? '[]') as string[]) {
      await adoptPretranslated(file.id, language, userId);
    }
  }

  return {
    fileId: file.id,
    revision,
    added: plan.added.length,
    changed: plan.changed.length,
    removed: plan.removed.length,
  };
}

/** Ειδοποιεί όλα τα ΥΠΟΛΟΙΠΑ μέλη — απόφαση προδιαγραφής: όλοι, όχι μόνο όσοι έχουν ήδη σχέση με το αρχείο. */
async function notifyOtherMembers(
  projectId: string,
  actorId: string,
  type: (typeof NotificationType)['FILE_UPLOAD'] | (typeof NotificationType)['FILE_UPDATE'],
  fileName: string,
  fileId: string,
): Promise<void> {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  await notifyMany(members.map((m) => m.userId), {
    projectId,
    type,
    target: fileName,
    link: `/projects/${projectId}/files/${fileId}`,
    actorId,
  });
}

/**
 * Ροή NDJSON: μία γραμμή JSON ανά στάδιο επεξεργασίας, ώστε ο client να δείχνει
 * πραγματική πρόοδο αντί για ένα ενιαίο response στο τέλος. Μόλις γραφτεί η κεφαλίδα
 * 200, ο κωδικός κατάστασης δεν αλλάζει πια — τα σφάλματα μεταδίδονται ως τελευταία
 * γραμμή με stage "error" αντί για HTTP status.
 */
function ndjsonEmitter(res: Response): (stage: string, extra?: object) => void {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
  return (stage, extra) => res.write(`${JSON.stringify({ stage, ...extra })}\n`);
}

filesRouter.post(
  '/',
  requireProjectRole({ managerOnly: true }),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Δεν στάλθηκε αρχείο' });
      return;
    }

    const projectId = req.params.projectId!;
    const jobKey = `add:${projectId}`;
    const emit = ndjsonEmitter(res);
    startJob(jobKey, { projectId, fileName: req.file.originalname });
    try {
      emit('parsing', { percent: 10 });
      const content = parseJsonUpload(req.file.buffer);
      const result = await ingestUpload({
        projectId,
        fileId: null,
        folderId: (req.body?.folderId as string) || null,
        name: req.file.originalname,
        content,
        userId: req.userId!,
        onProgress: (stage, percent) => {
          emit(stage, { percent });
          updateJob(jobKey, stage, undefined, percent);
        },
      });
      await logActivity({
        projectId,
        userId: req.userId!,
        action: ActivityAction.FILE_UPLOAD,
        target: req.file.originalname,
      });
      await notifyOtherMembers(
        projectId,
        req.userId!,
        NotificationType.FILE_UPLOAD,
        req.file.originalname,
        result.fileId,
      );
      updateJob(jobKey, 'done');
      emit('done', result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Αποτυχία εισαγωγής';
      updateJob(jobKey, 'error', message);
      emit('error', { error: message });
    } finally {
      finishJob(jobKey);
      res.end();
    }
  },
);

filesRouter.get('/active-uploads', requireProjectRole(), (req, res) => {
  res.json(getJobsForProject(req.params.projectId!));
});

filesRouter.post(
  '/:fileId/revisions',
  requireProjectRole({ managerOnly: true }),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Δεν στάλθηκε αρχείο' });
      return;
    }

    const file = await prisma.sourceFile.findFirst({
      where: { id: req.params.fileId, projectId: req.params.projectId },
    });
    if (!file) {
      res.status(404).json({ error: 'Το αρχείο δεν βρέθηκε' });
      return;
    }

    const projectId = req.params.projectId!;
    const jobKey = `update:${file.id}`;
    const emit = ndjsonEmitter(res);
    startJob(jobKey, { projectId, fileId: file.id, fileName: file.name });
    try {
      emit('parsing', { percent: 10 });
      const content = parseJsonUpload(req.file.buffer);
      const result = await ingestUpload({
        projectId,
        fileId: file.id,
        folderId: file.folderId,
        name: file.name,
        content,
        userId: req.userId!,
        onProgress: (stage, percent) => {
          emit(stage, { percent });
          updateJob(jobKey, stage, undefined, percent);
        },
      });
      await logActivity({
        projectId,
        userId: req.userId!,
        action: ActivityAction.FILE_UPDATE,
        target: file.name,
      });
      await notifyOtherMembers(
        projectId,
        req.userId!,
        NotificationType.FILE_UPDATE,
        file.name,
        file.id,
      );
      updateJob(jobKey, 'done');
      emit('done', result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Αποτυχία ενημέρωσης';
      updateJob(jobKey, 'error', message);
      emit('error', { error: message });
    } finally {
      finishJob(jobKey);
      res.end();
    }
  },
);

filesRouter.delete('/:fileId', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const file = await prisma.sourceFile.findFirst({
    where: { id: req.params.fileId, projectId: req.params.projectId },
  });
  if (!file) {
    res.status(404).json({ error: 'Το αρχείο δεν βρέθηκε' });
    return;
  }
  await prisma.sourceFile.delete({ where: { id: file.id } });
  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.FILE_DELETE,
    target: file.name,
  });
  res.status(204).end();
});

/* ── Εξαγωγή μεταφρασμένου αρχείου ─────────────────────────────────────────── */

filesRouter.get('/:fileId/export', requireProjectRole(), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  const file = await prisma.sourceFile.findFirst({
    where: { id: req.params.fileId, projectId: req.params.projectId },
    include: { versions: { orderBy: { revision: 'desc' }, take: 1 } },
  });

  if (!project || !file || !file.versions[0]) {
    res.status(404).json({ error: 'Το αρχείο δεν βρέθηκε' });
    return;
  }

  const language = (req.query.language as string) || primaryTarget(project.targetLanguages);

  const strings = await prisma.sourceString.findMany({
    where: { fileId: file.id },
    include: { translations: { where: { language } } },
  });

  const translations = new Map(
    strings
      .filter((s) => s.translations[0]?.text)
      .map((s) => [s.key, s.translations[0]!.text]),
  );

  // Ξαναχτίζουμε από το ακατέργαστο JSON της τελευταίας αναθεώρησης, ώστε η δομή να
  // είναι ακριβώς αυτή που ανέβασε ο χρήστης.
  const source = JSON.parse(file.versions[0].rawJson) as JsonValue;
  const output = unflatten(flatten(source), translations);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', attachmentHeader(file.name));
  res.send(JSON.stringify(output, null, 2));
});
