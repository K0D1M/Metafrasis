import { Router } from 'express';
import { createRequire } from 'node:module';
import type { Archiver, ArchiverOptions } from 'archiver';

// Το archiver είναι CommonJS και εξάγει συνάρτηση-εργοστάσιο. Το @types/archiver v8
// δηλώνει μόνο κλάσεις (χωρίς default export), οπότε ο τύπος μπαίνει χειροκίνητα.
// Επαληθευμένο στο runtime: archiver('zip', …) δίνει έγκυρο αρχείο με υπογραφή "PK".
const require = createRequire(import.meta.url);
const archiver = require('archiver') as (
  format: 'zip' | 'tar',
  options?: ArchiverOptions,
) => Archiver;
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { flatten, unflatten, type JsonValue } from '../services/jsonFlatten.js';
import { attachmentHeader } from '../services/contentDisposition.js';
import { progressByFile } from '../services/progress.js';

export const translationsRouter: Router = Router({ mergeParams: true });

function primaryTarget(targetLanguages: string): string {
  return (JSON.parse(targetLanguages) as string[])[0] ?? 'el';
}

/**
 * Κατέβασμα όλων των μεταφρασμένων αρχείων ως .zip.
 *
 * Κάθε αρχείο ξαναχτίζεται από το ακατέργαστο JSON της τελευταίας αναθεώρησης, ώστε
 * η δομή να είναι ακριβώς αυτή που ανέβασε ο χρήστης. Όπου λείπει μετάφραση μένει το
 * πρωτότυπο, ώστε το παιχνίδι να φορτώνει πάντα.
 */
translationsRouter.get('/download', requireProjectRole(), async (req, res) => {
  const projectId = req.params.projectId!;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: 'Το project δεν βρέθηκε' });
    return;
  }

  const language = (req.query.language as string) || primaryTarget(project.targetLanguages);

  const files = await prisma.sourceFile.findMany({
    where: { projectId },
    include: {
      folder: { select: { name: true } },
      versions: { orderBy: { revision: 'desc' }, take: 1 },
      strings: { include: { translations: { where: { language } } } },
    },
  });

  const usable = files.filter((file) => file.versions[0]);
  if (usable.length === 0) {
    res.status(404).json({ error: 'Δεν υπάρχουν αρχεία για εξαγωγή' });
    return;
  }

  const archive = archiver('zip', { zlib: { level: 9 } });

  // Τα headers φεύγουν πριν το πρώτο byte· ένα σφάλμα μετά από αυτό δεν μπορεί πια
  // να γίνει JSON απάντηση, οπότε το μόνο που μένει είναι να κλείσουμε τη σύνδεση.
  archive.on('error', (error: Error) => {
    console.error('[metafrasis] σφάλμα συμπίεσης:', error);
    res.destroy();
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', attachmentHeader(`${project.name}_${language}.zip`));
  archive.pipe(res);

  for (const file of usable) {
    const translations = new Map(
      file.strings
        .filter((s) => s.translations[0]?.text)
        .map((s) => [s.key, s.translations[0]!.text]),
    );

    const source = JSON.parse(file.versions[0]!.rawJson) as JsonValue;
    const output = unflatten(flatten(source), translations);

    // Ο φάκελος του project διατηρείται μέσα στο zip.
    const path = file.folder ? `${file.folder.name}/${file.name}` : file.name;
    archive.append(JSON.stringify(output, null, 2), { name: path });
  }

  await archive.finalize();
});

/** Σύνοψη ανά αρχείο, για την καρτέλα Μεταφράσεις. */
translationsRouter.get('/summary', requireProjectRole(), async (req, res) => {
  const projectId = req.params.projectId!;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: 'Το project δεν βρέθηκε' });
    return;
  }

  const language = (req.query.language as string) || primaryTarget(project.targetLanguages);

  const [files, progress] = await Promise.all([
    prisma.sourceFile.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    progressByFile(projectId, language),
  ]);

  res.json({
    language,
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      ...(progress.get(file.id) ?? { total: 0, translated: 0, percent: 0 }),
    })),
  });
});
