/**
 * Υπολογισμός προόδου: η μπάρα μετρά πόσα από τα μεταφράσιμα κείμενα έχουν πραγματική
 * μετάφραση — όχι απλώς μη κενό κείμενο, αλλά κείμενο που περιέχει έστω έναν χαρακτήρα
 * του αλφαβήτου της γλώσσας-στόχου (βλ. LANGUAGE_SCRIPT_PATTERN πιο κάτω). Ένα πεδίο
 * με κενά ή με κείμενο σε λάθος γλώσσα δεν πρέπει να μετράει ως μεταφρασμένο.
 *
 * Ένα αρχείο σημασμένο completed μετρά ολόκληρο ως μεταφρασμένο.
 *
 * Εξαιρέσεις: ένα κείμενο «Χρειάζεται έλεγχος» δεν μετρά μέχρι να ελεγχθεί, ενώ ένα
 * σημασμένο «δεν χρειάζεται μετάφραση» (skipped) μετρά χωρίς κείμενο. Ίδιος κανόνας με
 * το isDone() στο client/src/pages/StringEditor.tsx.
 */
import type { ProgressStats } from '@metafrasis/shared';
import { prisma } from '../db.js';

/** Κείμενα σημασμένα ως removed δεν μετρούν — λείπουν από το τρέχον αρχείο. */
export function computeProgress(total: number, translated: number): ProgressStats {
  const percent = total === 0 ? 0 : Math.round((translated / total) * 100);
  return { total, translated, percent };
}

/**
 * Regex ανά γλώσσα-στόχο για το Postgres `~` operator, αντίστοιχο του
 * LANGUAGE_SCRIPTS στο client/src/pages/StringEditor.tsx — κρατάμε τα δύο σε
 * αντιστοιχία αν προστεθεί νέα γλώσσα.
 */
export const LANGUAGE_SCRIPT_PATTERN: Record<string, string> = {
  el: '[Ͱ-Ͽἀ-῿]',
  en: '[a-zA-Z]',
};

export function scriptPattern(language: string): string {
  return LANGUAGE_SCRIPT_PATTERN[language] ?? '.'; // Άγνωστη γλώσσα: αρκεί οποιοσδήποτε χαρακτήρας.
}

/**
 * Πρόοδος ανά αρχείο για ένα project, σε δύο ερωτήματα αντί για δύο ανά αρχείο.
 * Επιστρέφει χάρτη fileId → στατιστικά.
 */
export async function progressByFile(
  projectId: string,
  language: string,
): Promise<Map<string, ProgressStats>> {
  const totals = await prisma.sourceString.groupBy({
    by: ['fileId'],
    where: { file: { projectId }, removed: false },
    _count: { _all: true },
  });

  const pattern = scriptPattern(language);
  const translatedRows = await prisma.$queryRaw<Array<{ fileId: string; count: bigint }>>`
    SELECT ss."fileId" as "fileId", COUNT(*)::bigint as count
    FROM "SourceString" ss
    JOIN "SourceFile" sf ON sf.id = ss."fileId"
    WHERE sf."projectId" = ${projectId}
      AND ss.removed = false
      AND (
        sf.completed
        OR (
          ss."needsReview" = false
          AND EXISTS (
            SELECT 1 FROM "Translation" t
            WHERE t."stringId" = ss.id
              AND t.language = ${language}
              AND (t.skipped OR t.text ~ ${pattern})
          )
        )
      )
    GROUP BY ss."fileId"
  `;

  const translatedByFile = new Map(translatedRows.map((row) => [row.fileId, Number(row.count)]));

  return new Map(
    totals.map((row) => [
      row.fileId,
      computeProgress(row._count._all, translatedByFile.get(row.fileId) ?? 0),
    ]),
  );
}

/** Συνολική πρόοδος ενός project — η κύρια μπάρα του Dashboard. */
export async function projectProgress(
  projectId: string,
  language: string,
): Promise<ProgressStats> {
  const pattern = scriptPattern(language);
  const [total, translatedRows] = await Promise.all([
    prisma.sourceString.count({ where: { file: { projectId }, removed: false } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM "SourceString" ss
      JOIN "SourceFile" sf ON sf.id = ss."fileId"
      WHERE sf."projectId" = ${projectId}
        AND ss.removed = false
        AND (
          sf.completed
          OR (
            ss."needsReview" = false
            AND EXISTS (
              SELECT 1 FROM "Translation" t
              WHERE t."stringId" = ss.id
                AND t.language = ${language}
                AND (t.skipped OR t.text ~ ${pattern})
            )
          )
        )
    `,
  ]);

  return computeProgress(total, Number(translatedRows[0]?.count ?? 0));
}
