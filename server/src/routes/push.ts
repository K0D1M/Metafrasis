import { Router } from 'express';
import { pushSubscriptionSchema, pushUnsubscribeSchema } from '@metafrasis/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';
import { getVapidKeys, sendPush } from '../services/push.js';

/**
 * Συνδρομές Web Push ανά συσκευή. Όπως οι ειδοποιήσεις, δεν ανήκουν σε project — ο
 * χρήστης ενεργοποιεί τις ειδοποιήσεις επιφάνειας εργασίας μία φορά για όλα.
 */
export const pushRouter: Router = Router();

pushRouter.use(requireAuth);

/** Το δημόσιο κλειδί VAPID που χρειάζεται ο browser για το pushManager.subscribe(). */
pushRouter.get('/public-key', async (_req, res) => {
  try {
    const { publicKey } = await getVapidKeys();
    res.json({ publicKey });
  } catch (error) {
    console.error('[metafrasis] αποτυχία φόρτωσης κλειδιών VAPID:', error);
    res.status(503).json({ error: 'Οι ειδοποιήσεις επιφάνειας εργασίας δεν είναι διαθέσιμες' });
  }
});

pushRouter.post('/subscriptions', async (req, res) => {
  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρη συνδρομή ειδοποιήσεων' });
    return;
  }
  const { endpoint, keys } = parsed.data;

  // Upsert ανά endpoint: αν στον ίδιο browser είχε ενεργοποιήσει άλλος χρήστης, η
  // συσκευή περνά στον τρέχοντα — ποτέ δεν λαμβάνει ειδοποιήσεις δύο λογαριασμών.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: req.userId! },
    update: { p256dh: keys.p256dh, auth: keys.auth, userId: req.userId! },
  });
  res.status(204).end();
});

// Το endpoint έρχεται στο query: ο api client του app στέλνει DELETE χωρίς σώμα.
pushRouter.delete('/subscriptions', async (req, res) => {
  const parsed = pushUnsubscribeSchema.safeParse({ endpoint: req.query.endpoint });
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρη συνδρομή ειδοποιήσεων' });
    return;
  }
  // Μόνο τη δική του — ίδια λογική με το notifications/:id/read.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: req.userId! },
  });
  res.status(204).end();
});

/** Δοκιμαστική ειδοποίηση στις συσκευές του ίδιου του χρήστη, από τις ρυθμίσεις. */
pushRouter.post('/test', async (req, res) => {
  const delivered = await sendPush([req.userId!], {
    title: 'Οι ειδοποιήσεις λειτουργούν',
    body: 'Έτσι θα βλέπεις τις νέες ειδοποιήσεις του Μετάφρασις.',
    url: '/',
    tag: 'metafrasis-test',
  });
  res.json({ delivered });
});
