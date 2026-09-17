import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import {
  ActivityAction,
  ALLOWED_IMAGE_TYPES,
  MAX_SCREENSHOT_BYTES,
  Role,
  type ScreenshotView,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { logActivity } from '../services/activity.js';
import {
  uploadScreenshot,
  deleteScreenshot,
  getScreenshotUrl,
  getScreenshotDownloadUrl,
} from '../storage.js';

export const screenshotsRouter: Router = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCREENSHOT_BYTES },
  fileFilter: (_req, file, callback) => {
    if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error('Επιτρέπονται μόνο εικόνες PNG, JPEG, WebP ή GIF'));
    }
  },
});

async function toView(row: {
  id: string;
  storedName: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploader: { id: string; username: string; avatarUrl: string | null };
  comment: string | null;
}): Promise<ScreenshotView> {
  return {
    id: row.id,
    // Υπογεγραμμένος σύνδεσμος: το bucket είναι ιδιωτικό, ισχύει προσωρινά.
    url: await getScreenshotUrl(row.storedName),
    // Ίδιο αρχείο, μόνο με Content-Disposition: attachment ώστε ο browser να το κατεβάζει.
    downloadUrl: await getScreenshotDownloadUrl(row.storedName, row.originalName),
    originalName: row.originalName,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt.toISOString(),
    uploader: row.uploader,
    comment: row.comment,
  };
}

screenshotsRouter.get('/', requireProjectRole(), async (req, res) => {
  const rows = await prisma.screenshot.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { uploadedAt: 'desc' },
    include: { uploader: { select: { id: true, username: true, avatarUrl: true } } },
  });
  res.json(await Promise.all(rows.map(toView)));
});

screenshotsRouter.post('/', requireProjectRole(), upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Δεν στάλθηκε εικόνα' });
    return;
  }

  const projectId = req.params.projectId!;
  // Τυχαίο όνομα, με το project ως φάκελο μέσα στο bucket — τακτοποιεί τα αρχεία
  // και δύο μέλη μπορούν να ανεβάσουν "bug.png" την ίδια στιγμή χωρίς σύγκρουση.
  const storedName = `${projectId}/${randomBytes(16).toString('hex')}${extname(req.file.originalname) || '.png'}`;

  try {
    await uploadScreenshot(storedName, req.file.buffer, req.file.mimetype);
  } catch (error) {
    console.error('[metafrasis] αποτυχία ανεβάσματος στο Storage:', error);
    res.status(502).json({ error: 'Αποτυχία αποθήκευσης της εικόνας' });
    return;
  }

  const comment = (req.body?.comment as string)?.trim() || null;

  const row = await prisma.screenshot.create({
    data: {
      projectId,
      storedName,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedBy: req.userId!,
      comment,
    },
    include: { uploader: { select: { id: true, username: true, avatarUrl: true } } },
  });

  await logActivity({
    projectId,
    userId: req.userId!,
    action: ActivityAction.SCREENSHOT_UPLOAD,
    target: req.file.originalname,
  });

  res.status(201).json(await toView(row));
});

screenshotsRouter.delete('/:screenshotId', requireProjectRole(), async (req, res) => {
  const row = await prisma.screenshot.findFirst({
    where: { id: req.params.screenshotId, projectId: req.params.projectId },
  });
  if (!row) {
    res.status(404).json({ error: 'Το στιγμιότυπο δεν βρέθηκε' });
    return;
  }

  // Ο καθένας σβήνει τα δικά του· ο διαχειριστής οποιοδήποτε.
  if (row.uploadedBy !== req.userId && req.projectRole !== Role.MANAGER) {
    res.status(403).json({ error: 'Μπορείς να διαγράψεις μόνο τα δικά σου στιγμιότυπα' });
    return;
  }

  await prisma.screenshot.delete({ where: { id: row.id } });
  await deleteScreenshot(row.storedName);

  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.SCREENSHOT_DELETE,
    target: row.originalName,
  });

  res.status(204).end();
});
