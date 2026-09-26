import { Router } from 'express';
import {
  ActivityAction,
  saveTranslationSchema,
  skipTranslationSchema,
  createCommentSchema,
  NotificationType,
  extractMentions,
  type SourceStringView,
  type CommentView,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { logActivity } from '../services/activity.js';
import { notify, notifyMany } from '../services/notify.js';

export const stringsRouter: Router = Router({ mergeParams: true });

function primaryTarget(targetLanguages: string): string {
  return (JSON.parse(targetLanguages) as string[])[0] ?? 'el';
}

/** Επιβεβαιώνει ότι το κείμενο ανήκει όντως στο project της διαδρομής. */
async function stringInProject(stringId: string, projectId: string) {
  return prisma.sourceString.findFirst({
    where: { id: stringId, file: { projectId } },
  });
}

/* ── Κείμενα ενός αρχείου ──────────────────────────────────────────────────── */

stringsRouter.get('/files/:fileId/strings', requireProjectRole(), async (req, res) => {
  const projectId = req.params.projectId!;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: 'Το project δεν βρέθηκε' });
    return;
  }

  const file = await prisma.sourceFile.findFirst({
    where: { id: req.params.fileId, projectId },
  });
  if (!file) {
    res.status(404).json({ error: 'Το αρχείο δεν βρέθηκε' });
    return;
  }

  const language = (req.query.language as string) || primaryTarget(project.targetLanguages);

  const strings = await prisma.sourceString.findMany({
    where: { fileId: file.id, removed: false },
    orderBy: { order: 'asc' },
    include: {
      translations: {
        where: { language },
        include: { author: { select: { username: true, avatarUrl: true } } },
      },
      _count: { select: { comments: true } },
    },
  });

  res.json({
    fileName: file.name,
    completed: file.completed,
    language,
    strings: strings.map(
      (s): SourceStringView => ({
        id: s.id,
        key: s.key,
        sourceText: s.sourceText,
        order: s.order,
        needsReview: s.needsReview,
        removed: s.removed,
        translation: s.translations[0]?.text ?? null,
        skipped: s.translations[0]?.skipped ?? false,
        translatedAt: s.translations[0]?.updatedAt.toISOString() ?? null,
        translatedBy: s.translations[0]?.author ?? null,
        commentCount: s._count.comments,
      }),
    ),
  });
});

/* ── Αποθήκευση μετάφρασης ─────────────────────────────────────────────────── */

stringsRouter.put('/strings/:stringId/translation', requireProjectRole(), async (req, res) => {
  const parsed = saveTranslationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρη μετάφραση' });
    return;
  }

  const target = await stringInProject(req.params.stringId!, req.params.projectId!);
  if (!target) {
    res.status(404).json({ error: 'Το κείμενο δεν βρέθηκε' });
    return;
  }

  const { text, language } = parsed.data;

  await prisma.$transaction([
    prisma.translation.upsert({
      where: { stringId_language: { stringId: target.id, language } },
      create: { stringId: target.id, language, text, authorId: req.userId! },
      // Γραπτή μετάφραση αντικαθιστά τη σήμανση «δεν χρειάζεται μετάφραση».
      update: { text, skipped: false, authorId: req.userId! },
    }),
    // Η αποθήκευση σημαίνει ότι ο μεταφραστής είδε το νέο πρωτότυπο.
    prisma.sourceString.update({
      where: { id: target.id },
      data: { needsReview: false },
    }),
  ]);

  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.TRANSLATION_SAVE,
    target: target.key,
  });

  res.status(204).end();
});

/** Επιβεβαίωση ελέγχου χωρίς αλλαγή στη μετάφραση — π.χ. ο μεταφραστής είδε το
 * νέο πρωτότυπο και αποφασίζει ότι η υπάρχουσα μετάφραση παραμένει σωστή. */
stringsRouter.patch('/strings/:stringId/review', requireProjectRole(), async (req, res) => {
  const target = await stringInProject(req.params.stringId!, req.params.projectId!);
  if (!target) {
    res.status(404).json({ error: 'Το κείμενο δεν βρέθηκε' });
    return;
  }

  await prisma.sourceString.update({
    where: { id: target.id },
    data: { needsReview: false },
  });

  res.status(204).end();
});

/** «Δεν χρειάζεται μετάφραση», ανά γλώσσα. Αποθηκεύεται με κενό text ώστε η εξαγωγή
 * να κρατά το πρωτότυπο· η αναίρεση σβήνει τη γραμμή, αφού δεν περιέχει μετάφραση. */
stringsRouter.put('/strings/:stringId/skip', requireProjectRole(), async (req, res) => {
  const parsed = skipTranslationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία' });
    return;
  }

  const target = await stringInProject(req.params.stringId!, req.params.projectId!);
  if (!target) {
    res.status(404).json({ error: 'Το κείμενο δεν βρέθηκε' });
    return;
  }

  const { language, skipped } = parsed.data;
  const where = { stringId_language: { stringId: target.id, language } };

  if (skipped) {
    await prisma.$transaction([
      prisma.translation.upsert({
        where,
        create: { stringId: target.id, language, text: '', skipped: true, authorId: req.userId! },
        update: { text: '', skipped: true, authorId: req.userId! },
      }),
      // Η σήμανση είναι απόφαση πάνω στο τρέχον πρωτότυπο — ισοδυναμεί με έλεγχο.
      prisma.sourceString.update({ where: { id: target.id }, data: { needsReview: false } }),
    ]);
  } else {
    await prisma.translation.deleteMany({
      where: { stringId: target.id, language, skipped: true },
    });
  }

  res.status(204).end();
});

/* ── Σχόλια και απαντήσεις ─────────────────────────────────────────────────── */

/** Χτίζει το δέντρο συζήτησης από μια επίπεδη λίστα, με μία διαδρομή. */
function buildThreads(
  rows: Array<{
    id: string;
    body: string;
    createdAt: Date;
    parentId: string | null;
    author: { id: string; username: string; avatarUrl: string | null };
  }>,
): CommentView[] {
  const views = new Map<string, CommentView>(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        author: r.author,
        replies: [],
      },
    ]),
  );

  const roots: CommentView[] = [];
  for (const row of rows) {
    const view = views.get(row.id)!;
    const parent = row.parentId ? views.get(row.parentId) : undefined;
    // Απάντηση σε σχόλιο που δεν βρέθηκε εμφανίζεται ως ρίζα, αντί να εξαφανιστεί.
    if (parent) parent.replies.push(view);
    else roots.push(view);
  }
  return roots;
}

stringsRouter.get('/strings/:stringId/comments', requireProjectRole(), async (req, res) => {
  const target = await stringInProject(req.params.stringId!, req.params.projectId!);
  if (!target) {
    res.status(404).json({ error: 'Το κείμενο δεν βρέθηκε' });
    return;
  }

  const rows = await prisma.comment.findMany({
    where: { stringId: target.id },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  });

  res.json(buildThreads(rows));
});

stringsRouter.post('/strings/:stringId/comments', requireProjectRole(), async (req, res) => {
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρο σχόλιο' });
    return;
  }

  const target = await stringInProject(req.params.stringId!, req.params.projectId!);
  if (!target) {
    res.status(404).json({ error: 'Το κείμενο δεν βρέθηκε' });
    return;
  }

  const { body, parentId } = parsed.data;

  // Η απάντηση πρέπει να ανήκει στο ίδιο κείμενο, αλλιώς μπερδεύονται οι συζητήσεις.
  let parent: { id: string; authorId: string } | null = null;
  if (parentId) {
    parent = await prisma.comment.findFirst({
      where: { id: parentId, stringId: target.id },
      select: { id: true, authorId: true },
    });
    if (!parent) {
      res.status(400).json({ error: 'Το σχόλιο στο οποίο απαντάς δεν βρέθηκε' });
      return;
    }
  }

  const comment = await prisma.comment.create({
    data: { stringId: target.id, authorId: req.userId!, body, parentId: parentId ?? null },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  });

  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.COMMENT_ADD,
    target: target.key,
  });

  // Απάντηση: ειδοποιείται ο συγγραφέας του γονικού σχολίου. Νέο σχόλιο σε κείμενο με
  // υπάρχουσα μετάφραση: ειδοποιείται ο μεταφραστής — αυτός είναι που θέλει να ξέρει.
  // Το notify() παραλείπει σιωπηλά τον ίδιο τον σχολιαστή, όποια από τις δύο περιπτώσεις.
  let recipientId: string | null = parent?.authorId ?? null;
  if (!recipientId) {
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId! } });
    const language = primaryTarget(project?.targetLanguages ?? '["el"]');
    const translation = await prisma.translation.findUnique({
      where: { stringId_language: { stringId: target.id, language } },
      select: { authorId: true },
    });
    recipientId = translation?.authorId ?? null;
  }
  if (recipientId) {
    await notify({
      userId: recipientId,
      projectId: req.params.projectId!,
      type: NotificationType.COMMENT_REPLY,
      target: target.key,
      link: `/projects/${req.params.projectId}/files/${target.fileId}`,
      actorId: req.userId!,
    });
  }

  // @αναφορές: ειδοποιούμε κάθε αναφερόμενο μέλος, εκτός από όποιον ήδη ειδοποιήθηκε
  // παραπάνω (απάντηση/μεταφραστής) — το notifyMany αποκλείει ήδη τον ίδιο τον συγγραφέα.
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.projectId! },
    include: { user: { select: { id: true, username: true } } },
  });
  const mentionedUsernames = extractMentions(body, new Set(members.map((m) => m.user.username)));
  const mentionedUserIds = members
    .filter((m) => mentionedUsernames.includes(m.user.username) && m.user.id !== recipientId)
    .map((m) => m.user.id);
  if (mentionedUserIds.length > 0) {
    await notifyMany(mentionedUserIds, {
      projectId: req.params.projectId!,
      type: NotificationType.COMMENT_MENTION,
      target: target.key,
      link: `/projects/${req.params.projectId}/files/${target.fileId}`,
      actorId: req.userId!,
    });
  }

  res.status(201).json({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    author: comment.author,
    replies: [],
  } satisfies CommentView);
});

stringsRouter.delete('/comments/:commentId', requireProjectRole(), async (req, res) => {
  const comment = await prisma.comment.findFirst({
    where: { id: req.params.commentId, string: { file: { projectId: req.params.projectId } } },
  });
  if (!comment) {
    res.status(404).json({ error: 'Το σχόλιο δεν βρέθηκε' });
    return;
  }

  // Ο καθένας σβήνει τα δικά του· ο διαχειριστής οποιοδήποτε.
  if (comment.authorId !== req.userId && req.projectRole !== 'MANAGER') {
    res.status(403).json({ error: 'Μπορείς να διαγράψεις μόνο τα δικά σου σχόλια' });
    return;
  }

  await prisma.comment.delete({ where: { id: comment.id } });
  res.status(204).end();
});
