/**
 * Αρχεία που ανέβηκαν ήδη μισομεταφρασμένα: όπου το πρωτότυπο είναι ήδη στη γλώσσα-στόχο,
 * το ίδιο κείμενο γίνεται και μετάφραση, ώστε να μετρά στην πρόοδο. Υπάρχουσες
 * μεταφράσεις και σημάνσεις «δεν χρειάζεται μετάφραση» δεν αγγίζονται ποτέ.
 */
import { prisma } from '../db.js';
import { LANGUAGE_SCRIPT_PATTERN } from './progress.js';

export async function adoptPretranslated(
  fileId: string,
  language: string,
  authorId: string,
): Promise<number> {
  // Χωρίς γνωστό αλφάβητο το μοτίβο θα ταίριαζε σε κάθε κείμενο του αρχείου.
  const pattern = LANGUAGE_SCRIPT_PATTERN[language];
  if (!pattern) return 0;

  return prisma.$executeRaw`
    INSERT INTO "Translation" (id, "stringId", language, text, skipped, "authorId", "updatedAt")
    SELECT gen_random_uuid()::text, ss.id, ${language}, ss."sourceText", false, ${authorId}, NOW()
    FROM "SourceString" ss
    WHERE ss."fileId" = ${fileId} AND ss.removed = false AND ss."sourceText" ~ ${pattern}
    ON CONFLICT ("stringId", language) DO NOTHING
  `;
}
