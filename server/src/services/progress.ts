/**
 * Υπολογισμός προόδου: η μπάρα μετρά πόσα από τα μεταφράσιμα κείμενα έχουν μετάφραση.
 */
import type { ProgressStats } from '@metafrasis/shared';
import { prisma } from '../db.js';

/** Κείμενα σημασμένα ως removed δεν μετρούν — λείπουν από το τρέχον αρχείο. */
export function computeProgress(total: number, translated: number): ProgressStats {
  const percent = total === 0 ? 0 : Math.round((translated / total) * 100);
  return { total, translated, percent };
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

  const translated = await prisma.sourceString.groupBy({
    by: ['fileId'],
    where: {
      file: { projectId },
      removed: false,
      // Κενή μετάφραση δεν μετρά ως ολοκληρωμένη.
      translations: { some: { language, NOT: { text: '' } } },
    },
    _count: { _all: true },
  });

  const translatedByFile = new Map(translated.map((row) => [row.fileId, row._count._all]));

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
  const [total, translated] = await Promise.all([
    prisma.sourceString.count({ where: { file: { projectId }, removed: false } }),
    prisma.sourceString.count({
      where: {
        file: { projectId },
        removed: false,
        translations: { some: { language, NOT: { text: '' } } },
      },
    }),
  ]);

  return computeProgress(total, translated);
}
