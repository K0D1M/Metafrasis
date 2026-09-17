import { PrismaClient } from '@prisma/client';

/**
 * Ένα μοναδικό instance. Σε dev, το tsx watch κάνει reload τη μονάδα σε κάθε αλλαγή·
 * χωρίς το cache στο globalThis θα ανοίγαμε νέο connection pool κάθε φορά.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: ExtendedPrismaClient;
  prismaBase?: PrismaClient;
};

/**
 * Μεταμφίεση ονόματος χρήστη για απενεργοποιημένους λογαριασμούς: κάθε φορά που
 * διαβάζεται User.username μαζί με το User.id, αν ο λογαριασμός είναι απενεργοποιημένος
 * (deactivatedAt ≠ null) το username αντικαθίσταται με "deactivated_user_<id>" πριν
 * φτάσει καν στον κώδικα του route. Ισχύει παντού όπου διαβάζεται User μέσω αυτού του
 * client — σχόλια, μεταφράσεις, εργασίες, αναφορές QA, λίστες μελών, κ.λπ. — χωρίς να
 * χρειάζεται να τροποποιηθεί κάθε route ξεχωριστά. Το ίδιο το admin dashboard διαβάζει
 * το πραγματικό username μέσω ξεχωριστού μη-μεταμφιεσμένου query (βλ. routes/admin.ts).
 *
 * Το ιστορικό δραστηριότητας (Activity.target) αποθηκεύει το username ως απλό κείμενο
 * τη στιγμή της ενέργειας — δεν είναι live join σε User — οπότε αυτή η επέκταση δεν το
 * αγγίζει καθόλου, σκόπιμα: παλιές καταχωρήσεις κρατούν το πραγματικό όνομα όπως ήταν.
 */
function extend(client: PrismaClient) {
  return client.$extends({
    result: {
      user: {
        username: {
          needs: { id: true, username: true, deactivatedAt: true },
          compute(user): string {
            return user.deactivatedAt ? `deactivated_user_${user.id}` : user.username;
          },
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof extend>;

const baseClient = globalForPrisma.prismaBase ?? new PrismaClient();

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? extend(baseClient);

/**
 * Ο ανεπηρέαστος client, χωρίς τη μεταμφίεση username — χρησιμοποιείται ΜΟΝΟ από το
 * admin router (routes/admin.ts), όπου ένας γενικός διαχειριστής πρέπει να βλέπει το
 * πραγματικό username για να διαχειριστεί/επαναφέρει έναν απενεργοποιημένο λογαριασμό.
 * Κάθε άλλη χρήση θα παρέκαμπτε σκόπιμα την ιδιωτικότητα που παρέχει η μεταμφίεση.
 */
export const prismaUnmasked: PrismaClient = baseClient;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaBase = baseClient;
}
