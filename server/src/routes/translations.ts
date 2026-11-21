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

  // Τρία στοχευμένα ερωτήματα αντί για ένα εμφωλευμένο include. Το include φόρτωνε κάθε
  // SourceString με όλες τις στήλες του και έστελνε τα ids τους ως παραμέτρους για τις
  // μεταφράσεις — αργό, και πάνω από ~32.000 κείμενα αποτύγχανε εντελώς (όριο Postgres
  // στις bind variables). Εδώ φέρνουμε μόνο ό,τι χρειάζεται η εξαγωγή.
  const [files, latestVersions, translationRows] = await Promise.all([
    prisma.sourceFile.findMany({
      where: { projectId },
      select: { id: true, name: true, folder: { select: { name: true } } },
    }),
    // Μόνο η τελευταία αναθεώρηση κάθε αρχείου — όχι όλο το ιστορικό rawJson.
    prisma.$queryRaw<Array<{ fileId: string; rawJson: string }>>`
      SELECT DISTINCT ON (fv."fileId") fv."fileId" AS "fileId", fv."rawJson" AS "rawJson"
      FROM "FileVersion" fv
      JOIN "SourceFile" sf ON sf.id = fv."fileId"
      WHERE sf."projectId" = ${projectId}
      ORDER BY fv."fileId", fv.revision DESC
    `,
    prisma.$queryRaw<Array<{ fileId: string; key: string; text: string }>>`
      SELECT ss."fileId" AS "fileId", ss.key AS key, t.text AS text
      FROM "Translation" t
      JOIN "SourceString" ss ON ss.id = t."stringId"
      JOIN "SourceFile" sf ON sf.id = ss."fileId"
      WHERE sf."projectId" = ${projectId}
        AND t.language = ${language}
        AND t.text <> ''
    `,
  ]);

  const rawJsonByFile = new Map(latestVersions.map((v) => [v.fileId, v.rawJson]));
  const translationsByFile = new Map<string, Map<string, string>>();
  for (const row of translationRows) {
    let map = translationsByFile.get(row.fileId);
    if (!map) translationsByFile.set(row.fileId, (map = new Map()));
    map.set(row.key, row.text);
  }

  const usable = files.filter((file) => rawJsonByFile.has(file.id));
  if (usable.length === 0) {
    res.status(404).json({ error: 'Δεν υπάρχουν αρχεία για εξαγωγή' });
    return;
  }

  // Επίπεδο 6 (το προεπιλεγμένο του zlib): σχεδόν ίδιο μέγεθος για JSON κείμενο, λιγότερη
  // CPU από το 9.
  const archive = archiver('zip', { zlib: { level: 6 } });

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
    const source = JSON.parse(rawJsonByFile.get(file.id)!) as JsonValue;
    const output = unflatten(flatten(source), translationsByFile.get(file.id));

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
