import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { MAX_SCREENSHOT_BYTES } from '@metafrasis/shared';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { filesRouter } from './routes/files.js';
import { stringsRouter } from './routes/strings.js';
import { screenshotsRouter } from './routes/screenshots.js';
import { tasksRouter } from './routes/tasks.js';
import { qaRouter } from './routes/qa.js';
import { activityRouter } from './routes/activity.js';
import { translationsRouter } from './routes/translations.js';
import { requireAuth } from './auth.js';
import { ensureScreenshotsBucket } from './storage.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const MAX_SCREENSHOT_MB = Math.round(MAX_SCREENSHOT_BYTES / (1024 * 1024));
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

// Σε production ο ίδιος server σερβίρει και το build του client (ίδιο origin, βλ. παρακάτω)·
// τα CORS headers χρειάζονται μόνο στο dev, όπου client και API τρέχουν σε άλλη θύρα.
const IS_DEV = process.env.NODE_ENV !== 'production';

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

if (IS_DEV) {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', CLIENT_ORIGIN);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Τα στιγμιότυπα ζουν πλέον στο Supabase Storage (ιδιωτικό bucket) — δεν σερβίρονται
// τοπικά· το API επιστρέφει υπογεγραμμένους συνδέσμους ανά αίτημα (δες routes/screenshots.ts).

app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
// Οι routers μοιράζονται το :projectId και κάνουν οι ίδιοι τον έλεγχο ρόλου.
app.use('/api/projects/:projectId/files', requireAuth, filesRouter);
app.use('/api/projects/:projectId/screenshots', requireAuth, screenshotsRouter);
app.use('/api/projects/:projectId/tasks', requireAuth, tasksRouter);
app.use('/api/projects/:projectId/qa', requireAuth, qaRouter);
app.use('/api/projects/:projectId/translations', requireAuth, translationsRouter);
app.use('/api/projects/:projectId', requireAuth, activityRouter);
app.use('/api/projects/:projectId', requireAuth, stringsRouter);

/**
 * Σε production, ο ίδιος server σερβίρει και το build του client — ένα service στο
 * Railway, ένα URL, χωρίς CORS. Ο φάκελος client/dist υπάρχει μόνο μετά το `npm run
 * build`· σε dev (όπου τρέχει το Vite ξεχωριστά) δεν υπάρχει, οπότε το παραλείπουμε.
 *
 * Η διαδρομή είναι σχετική με το ΜΕΤΑΓΛΩΤΤΙΣΜΕΝΟ index.js (server/dist/index.js).
 */
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));

  // SPA fallback: οποιαδήποτε διαδρομή εκτός /api (π.χ. /projects/abc/files/xyz μετά
  // από ανανέωση σελίδας) πρέπει να επιστρέφει το index.html, ώστε να αναλάβει ο
  // React Router στο client αντί να δώσει 404 ο server.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Η διαδρομή δεν βρέθηκε' });
});

app.use(
  (
    error: Error & { code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ): void => {
    // Το multer απορρίπτει μεγάλα ή λάθους τύπου αρχεία· αυτά είναι σφάλματα χρήστη,
    // όχι του διακομιστή, και αξίζουν κατανοητό μήνυμα.
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `Το αρχείο ξεπερνά το όριο των ${MAX_SCREENSHOT_MB} MB` });
      return;
    }
    if (error.message?.startsWith('Επιτρέπονται μόνο')) {
      res.status(400).json({ error: error.message });
      return;
    }

    console.error('[metafrasis]', error);
    res.status(500).json({ error: 'Σφάλμα διακομιστή' });
  },
);

/**
 * Ένα σφάλμα σε ασύγχρονο κώδικα μετά την αποστολή headers (π.χ. σε stream) δεν
 * πιάνεται από το error middleware του Express και τερματίζει τη διεργασία.
 * Το καταγράφουμε και συνεχίζουμε: ένα χαλασμένο αίτημα δεν πρέπει να ρίχνει
 * τον διακομιστή για όλη την ομάδα.
 */
process.on('uncaughtException', (error) => {
  console.error('[metafrasis] ανεπιτήρητη εξαίρεση:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[metafrasis] ανεπιτήρητη απόρριψη promise:', reason);
});

ensureScreenshotsBucket()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Μετάφρασις API: http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    // Χωρίς bucket, τα στιγμιότυπα αποτυγχάνουν σε κάθε αίτημα — καλύτερα να μη
    // ξεκινήσει καθόλου ο server παρά να δείχνει σαν να δουλεύει.
    console.error('[metafrasis] αποτυχία αρχικοποίησης Supabase Storage:', error);
    process.exit(1);
  });
