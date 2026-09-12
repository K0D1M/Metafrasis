import { PrismaClient } from '@prisma/client';

/**
 * Ένα μοναδικό instance. Σε dev, το tsx watch κάνει reload τη μονάδα σε κάθε αλλαγή·
 * χωρίς το cache στο globalThis θα ανοίγαμε νέο connection pool κάθε φορά.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
