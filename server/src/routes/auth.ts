import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import {
  ActivityAction,
  loginSchema,
  preferencesSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  Role,
  type PasswordResetResult,
  type SessionUser,
} from '@metafrasis/shared';
import { prisma } from '../db.js';
import { logActivity } from '../services/activity.js';
import { CLIENT_ORIGIN } from '../config.js';
import {
  hashPassword,
  verifyPassword,
  issueSession,
  clearSession,
  requireAuth,
} from '../auth.js';

/** Ίδια αναζήτηση χρησιμοποιείται στη σύνδεση και στην επαναφορά κωδικού. */
function findByIdentifier(identifier: string) {
  return prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
}

export const authRouter: Router = Router();

function toSessionUser(user: {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  recentTranslationsCount: number;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    recentTranslationsCount: user.recentTranslationsCount,
  };
}

/** Εγγραφή. Με inviteToken, ο χρήστης εντάσσεται αμέσως στο project της πρόσκλησης. */
authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
    return;
  }
  const { email, username, password, inviteToken } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    res.status(409).json({ error: 'Υπάρχει ήδη λογαριασμός με αυτό το email' });
    return;
  }
  // Το username είναι πλέον μοναδικό στη βάση — απαραίτητο για σύνδεση με όνομα χρήστη.
  if (await prisma.user.findUnique({ where: { username } })) {
    res.status(409).json({ error: 'Το όνομα χρήστη χρησιμοποιείται ήδη' });
    return;
  }

  // Η πρόσκληση επικυρώνεται πριν δημιουργηθεί ο χρήστης, ώστε να μην μένουν ορφανοί λογαριασμοί.
  const invite = inviteToken
    ? await prisma.invite.findUnique({ where: { token: inviteToken } })
    : null;

  if (inviteToken) {
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      res.status(400).json({ error: 'Ο σύνδεσμος πρόσκλησης δεν είναι έγκυρος ή έχει λήξει' });
      return;
    }
  }

  const user = await prisma.user.create({
    data: { email, username, passwordHash: await hashPassword(password) },
  });

  if (invite) {
    await prisma.$transaction([
      prisma.projectMember.create({
        data: { projectId: invite.projectId, userId: user.id, role: invite.role },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await logActivity({
      projectId: invite.projectId,
      userId: user.id,
      action: ActivityAction.MEMBER_JOIN,
      target: user.username,
    });
  }

  issueSession(res, user.id);
  res.status(201).json(toSessionUser(user));
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία' });
    return;
  }

  const user = await findByIdentifier(parsed.data.identifier);
  // Ίδιο μήνυμα είτε λείπει ο χρήστης είτε ο κωδικός είτε απενεργοποιημένος λογαριασμός —
  // δεν αποκαλύπτουμε σε κάποιον χωρίς πρόσβαση αν το πρόβλημα είναι ο κωδικός ή η κατάσταση του λογαριασμού.
  if (
    !user ||
    user.deactivatedAt ||
    !(await verifyPassword(user.passwordHash, parsed.data.password))
  ) {
    res.status(401).json({ error: 'Λάθος στοιχεία σύνδεσης' });
    return;
  }

  issueSession(res, user.id);
  res.json(toSessionUser(user));
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

/* ── Επαναφορά κωδικού ─────────────────────────────────────────────────────── */

const RESET_TOKEN_HOURS = 1;

/**
 * Ζητά σύνδεσμο επαναφοράς. Σε αντίθεση με την πρόσκληση μέλους (που την ξεκινά
 * διαχειριστής με ήδη γνωστό αποδέκτη), αυτό το αίτημα το κάνει ανώνυμος επισκέπτης —
 * γι' αυτό ΠΟΤΕ δεν αποκαλύπτουμε αν το identifier αντιστοιχεί σε λογαριασμό.
 * Χωρίς SMTP, ο σύνδεσμος εμφανίζεται στην οθόνη, όπως και η Δημιουργία Συνδέσμου μέλους.
 */
authRouter.post('/password-reset/request', async (req, res) => {
  const parsed = requestPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία' });
    return;
  }

  const user = await findByIdentifier(parsed.data.identifier);

  if (!user) {
    // Ίδια απάντηση σχήματος με επιτυχία, αλλά χωρίς σύνδεσμο — δεν επιβεβαιώνουμε ούτε
    // αρνούμαστε ότι υπάρχει λογαριασμός με αυτό το identifier.
    res.json({ url: null, expiresAt: null });
    return;
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);

  await prisma.passwordReset.create({ data: { userId: user.id, token, expiresAt } });

  res.json({
    url: `${CLIENT_ORIGIN}/reset-password?token=${token}`,
    expiresAt: expiresAt.toISOString(),
  } satisfies PasswordResetResult);
});

authRouter.post('/password-reset/confirm', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
    return;
  }

  const reset = await prisma.passwordReset.findUnique({ where: { token: parsed.data.token } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    res.status(400).json({ error: 'Ο σύνδεσμος επαναφοράς δεν είναι έγκυρος ή έχει λήξει' });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);

  // Σύνδεση αμέσως μετά, όπως και η εγγραφή — ο χρήστης δεν χρειάζεται δεύτερο βήμα.
  issueSession(res, user.id);
  res.json(toSessionUser(user));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    clearSession(res);
    res.status(401).json({ error: 'Ο λογαριασμός δεν βρέθηκε' });
    return;
  }
  res.json(toSessionUser(user));
});

// Ο client στέλνει data: URI (μικρό τετράγωνο JPEG, ~128px) — όχι πραγματικό αρχείο.
// 200KB καλύπτει άνετα μια τέτοια εικόνα με μεγάλο περιθώριο· ό,τι παραπάνω είναι
// είτε λάθος client είτε προσπάθεια να γεμίσει η βάση.
const MAX_AVATAR_DATA_URL_LENGTH = 200_000;

/** Το avatar το αλλάζει ο ίδιος ο χρήστης· το username μόνο ο διαχειριστής. */
authRouter.patch('/me/avatar', requireAuth, async (req, res) => {
  const raw = req.body?.avatarUrl;

  if (raw === null || raw === undefined) {
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { avatarUrl: null },
    });
    res.json(toSessionUser(user));
    return;
  }

  if (typeof raw !== 'string' || !raw.startsWith('data:image/')) {
    res.status(400).json({ error: 'Μη έγκυρη εικόνα avatar' });
    return;
  }
  if (raw.length > MAX_AVATAR_DATA_URL_LENGTH) {
    res.status(400).json({ error: 'Η εικόνα avatar είναι πολύ μεγάλη' });
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { avatarUrl: raw },
  });
  res.json(toSessionUser(user));
});

/** Προσωπικές ρυθμίσεις του χρήστη (π.χ. μέγεθος λίστας «Μεταφράστηκε τελευταία»). */
authRouter.patch('/me/preferences', requireAuth, async (req, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρη τιμή ρύθμισης' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { recentTranslationsCount: parsed.data.recentTranslationsCount },
  });
  res.json(toSessionUser(user));
});

/** Πληροφορίες πρόσκλησης, για να δείξει η σελίδα εγγραφής σε ποιο project μπαίνει ο χρήστης. */
authRouter.get('/invite/:token', async (req, res) => {
  const invite = await prisma.invite.findUnique({
    where: { token: req.params.token },
    include: { project: { select: { name: true } } },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    res.status(404).json({ error: 'Ο σύνδεσμος πρόσκλησης δεν είναι έγκυρος ή έχει λήξει' });
    return;
  }

  res.json({
    email: invite.email,
    role: invite.role as Role,
    projectName: invite.project.name,
    message: invite.message,
  });
});

/**
 * Αποδοχή πρόσκλησης από ήδη συνδεδεμένο χρήστη — η περίπτωση που δεν καλυπτόταν πριν:
 * κάποιος με λογαριασμό λαμβάνει σύνδεσμο πρόσκλησης, δεν μπορεί να κάνει εγγραφή (το
 * email υπάρχει ήδη) και μέχρι τώρα δεν υπήρχε κανένας τρόπος να μπει στο project.
 *
 * Σύγκριση email χωρίς διάκριση πεζών/κεφαλαίων — τα emails δεν κανονικοποιούνται
 * πουθενά αλλού στην εφαρμογή, οπότε δεν υποθέτουμε ότι ταιριάζουν byte-προς-byte.
 */
authRouter.post('/invite/:token/accept', requireAuth, async (req, res) => {
  const invite = await prisma.invite.findUnique({ where: { token: req.params.token } });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    res.status(400).json({ error: 'Ο σύνδεσμος πρόσκλησης δεν είναι έγκυρος ή έχει λήξει' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Απαιτείται σύνδεση' });
    return;
  }

  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    // Η πρόσκληση αφορά συγκεκριμένο email — δεν επιτρέπουμε σε άλλον λογαριασμό να τη
    // «κλέψει» επειδή έχει απλά ανοιχτή συνεδρία στο ίδιο πρόγραμμα περιήγησης.
    res.status(403).json({
      error: `Η πρόσκληση αφορά το ${invite.email} — συνδέθηκες ως ${user.email}`,
    });
    return;
  }

  const alreadyMember = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: invite.projectId, userId: user.id } },
  });
  if (alreadyMember) {
    // Ήδη μέλος — σημειώνουμε την πρόσκληση ως αποδεκτή ούτως ή άλλως, ώστε ο σύνδεσμος
    // να μη μείνει επ' αόριστον ενεργός, αλλά χωρίς σφάλμα προς τον χρήστη.
    await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    res.status(204).end();
    return;
  }

  await prisma.$transaction([
    prisma.projectMember.create({
      data: { projectId: invite.projectId, userId: user.id, role: invite.role },
    }),
    prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);

  await logActivity({
    projectId: invite.projectId,
    userId: user.id,
    action: ActivityAction.MEMBER_JOIN,
    target: user.username,
  });

  res.status(204).end();
});
