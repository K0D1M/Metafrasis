import { Router, type Response } from 'express';
import multer from 'multer';
import {
  createFolderSchema,
  type FolderNode,
  type SourceFileSummary,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { parseJsonUpload, planIngest } from '../services/ingest.js';
import { startJob, updateJob, finishJob, getJobsForProject } from '../services/uploadJobs.js';
import { progressByFile } from '../services/progress.js';
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
        versions: { orderBy: { revision: 'desc' }, take: 1 },
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
      }),
    ),
  });
});

/* ── Προσθήκη Αρχείου και Ενημέρωση ────────────────────────────────────────── */

export type IngestStage = 'parsing' | 'diffing' | 'saving';

/** Κοινή διαδρομή για πρώτο ανέβασμα και για Ενημέρωση υπάρχοντος αρχείου. */
async function ingestUpload(params: {
  projectId: string;
  fileId: string | null;
  folderId: string | null;
  name: string;
  content: JsonValue;
  userId: string;
  onProgress?: (stage: IngestStage) => void;
}): Promise<{ fileId: string; revision: number; added: number; changed: number; removed: number }> {
  const { projectId, folderId, name, content, userId, onProgress } = params;

  const file =
    params.fileId !== null
      ? await prisma.sourceFile.findUnique({ where: { id: params.fileId } })
      : await prisma.sourceFile.create({ data: { projectId, folderId, name } });

  if (!file) throw new Error('Το αρχείο δεν βρέθηκε');

  const existing = await prisma.sourceString.findMany({
    where: { fileId: file.id },
    select: { key: true, sourceText: true, removed: true },
  });

  onProgress?.('diffing');
  const plan = planIngest(
    content,
    existing.map((s) => ({ key: s.key, sourceText: s.sourceText })),
    new Set(existing.filter((s) => s.removed).map((s) => s.key)),
  );

  const lastVersion = await prisma.fileVersion.findFirst({
    where: { fileId: file.id },
    orderBy: { revision: 'desc' },
  });
  const revision = (lastVersion?.revision ?? 0) + 1;

  onProgress?.('saving');
  await prisma.$transaction([
    prisma.fileVersion.create({
      data: { fileId: file.id, revision, uploadedBy: userId, rawJson: JSON.stringify(content) },
    }),

    ...plan.added.map((a) =>
      prisma.sourceString.create({
        data: { fileId: file.id, key: a.key, sourceText: a.sourceText, order: a.order },
      }),
    ),

    // Το πρωτότυπο άλλαξε: κρατάμε τη μετάφραση αλλά τη σημαιοδοτούμε για έλεγχο.
    ...plan.changed.map((c) =>
      prisma.sourceString.update({
        where: { fileId_key: { fileId: file.id, key: c.key } },
        data: { sourceText: c.sourceText, order: c.order, needsReview: true, removed: false },
      }),
    ),

    ...plan.unchanged.map((u) =>
      prisma.sourceString.update({
        where: { fileId_key: { fileId: file.id, key: u.key } },
        data: { order: u.order, removed: false },
      }),
    ),

    // Σημαιοδότηση, ποτέ διαγραφή: το κλειδί μπορεί να επανέλθει με τη μετάφρασή του.
    ...plan.removed.map((key) =>
      prisma.sourceString.update({
        where: { fileId_key: { fileId: file.id, key } },
        data: { removed: true },
      }),
    ),
  ]);

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
      emit('parsing');
      const content = parseJsonUpload(req.file.buffer);
      const result = await ingestUpload({
        projectId,
        fileId: null,
        folderId: (req.body?.folderId as string) || null,
        name: req.file.originalname,
        content,
        userId: req.userId!,
        onProgress: (stage) => {
          emit(stage);
          updateJob(jobKey, stage);
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
      emit('parsing');
      const content = parseJsonUpload(req.file.buffer);
      const result = await ingestUpload({
        projectId,
        fileId: file.id,
        folderId: file.folderId,
        name: file.name,
        content,
        userId: req.userId!,
        onProgress: (stage) => {
          emit(stage);
          updateJob(jobKey, stage);
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
