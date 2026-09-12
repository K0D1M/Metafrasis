import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
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

export const screenshotsRouter: Router = Router({ mergeParams: true });

/** Τα αρχεία ζουν εκτός βάσης· η SQLite μένει μικρή και γρήγορη. */
export const UPLOAD_DIR = resolve(process.cwd(), 'uploads', 'screenshots');

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

function toView(row: {
  id: string;
  storedName: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploader: { id: string; username: string; avatarUrl: string | null };
}): ScreenshotView {
  return {
    id: row.id,
    url: `/api/screenshots/${row.storedName}`,
    originalName: row.originalName,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt.toISOString(),
    uploader: row.uploader,
  };
}

screenshotsRouter.get('/', requireProjectRole(), async (req, res) => {
  const rows = await prisma.screenshot.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { uploadedAt: 'desc' },
    include: { uploader: { select: { id: true, username: true, avatarUrl: true } } },
  });
  res.json(rows.map(toView));
});

screenshotsRouter.post('/', requireProjectRole(), upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Δεν στάλθηκε εικόνα' });
    return;
  }

  // Τυχαίο όνομα στον δίσκο: δύο μέλη μπορούν να ανεβάσουν "bug.png" την ίδια στιγμή.
  const storedName = `${randomBytes(16).toString('hex')}${extname(req.file.originalname) || '.png'}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, storedName), req.file.buffer);

  const row = await prisma.screenshot.create({
    data: {
      projectId: req.params.projectId!,
      storedName,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedBy: req.userId!,
    },
    include: { uploader: { select: { id: true, username: true, avatarUrl: true } } },
  });

  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.SCREENSHOT_UPLOAD,
    target: req.file.originalname,
  });

  res.status(201).json(toView(row));
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
  // Το αρχείο μπορεί να λείπει ήδη· η εγγραφή έφυγε, που είναι το ουσιώδες.
  await unlink(join(UPLOAD_DIR, row.storedName)).catch(() => {});

  await logActivity({
    projectId: req.params.projectId!,
    userId: req.userId!,
    action: ActivityAction.SCREENSHOT_DELETE,
    target: row.originalName,
  });

  res.status(204).end();
});
