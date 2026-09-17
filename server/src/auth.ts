import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import * as argon2 from 'argon2';
import { Role } from '@metafrasis/shared';
import { prisma } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Λείπει η μεταβλητή περιβάλλοντος JWT_SECRET');
}

const COOKIE_NAME = 'metafrasis_session';
const SESSION_DAYS = 7;

/* ── Κωδικοί ───────────────────────────────────────────────────────────────── */

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Κακοσχηματισμένο hash δεν πρέπει να ρίχνει τον server — απλώς αποτυγχάνει η σύνδεση.
    return false;
  }
}

/* ── Συνεδρία ──────────────────────────────────────────────────────────────── */

export function issueSession(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, JWT_SECRET as string, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      /** Ο ρόλος στο project της διαδρομής, όταν έχει τρέξει το requireProjectRole. */
      projectRole?: Role;
    }
  }
}

/**
 * Απαιτεί συνδεδεμένο χρήστη. Το JWT είναι stateless — δεν αρκεί μόνο η υπογραφή,
 * γιατί ένας απενεργοποιημένος λογαριασμός θα κρατούσε το cookie του λειτουργικό μέχρι
 * να λήξει φυσικά (έως 7 μέρες). Ο έλεγχος deactivatedAt εδώ σημαίνει ένα ερώτημα στη
 * βάση σε ΚΑΘΕ αίτημα, αποδεκτό κόστος για άμεση αποσύνδεση σε μια εφαρμογή αυτής της
 * κλίμακας.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Απαιτείται σύνδεση' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as { sub: string };

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deactivatedAt) {
      clearSession(res);
      res.status(401).json({ error: 'Η συνεδρία έληξε' });
      return;
    }

    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Η συνεδρία έληξε' });
  }
};

/**
 * Απαιτεί ιδιότητα μέλους στο project του :projectId.
 * Με `managerOnly`, επιτρέπει μόνο Διαχειριστές — αυτή είναι η πραγματική πύλη
 * ασφαλείας· η απόκρυψη κουμπιών στο client είναι μόνο καλλωπισμός.
 */
export function requireProjectRole(options: { managerOnly?: boolean } = {}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const projectId = req.params.projectId;
    if (!req.userId || !projectId) {
      res.status(400).json({ error: 'Λείπει το αναγνωριστικό project' });
      return;
    }

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: req.userId } },
    });

    if (!membership) {
      // Δεν αποκαλύπτουμε αν το project υπάρχει σε κάποιον που δεν είναι μέλος.
      res.status(404).json({ error: 'Το project δεν βρέθηκε' });
      return;
    }

    if (options.managerOnly && membership.role !== Role.MANAGER) {
      res.status(403).json({ error: 'Απαιτούνται δικαιώματα διαχειριστή' });
      return;
    }

    req.projectRole = membership.role as Role;
    next();
  };
}

/**
 * Απαιτεί γενικό διαχειριστή της εφαρμογής — ανεξάρτητο από ρόλο σε οποιοδήποτε
 * project. Δεν επαναχρησιμοποιεί το requireProjectRole: εκείνο κρύβει σκόπιμα την
 * ύπαρξη ενός project από όποιον δεν είναι μέλος (404 αντί για 403)· εδώ δεν υπάρχει
 * κάτι να κρυφτεί — ένα ειλικρινές 403 αρκεί.
 */
export const requireGlobalAdmin: RequestHandler = async (req, res, next) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Απαιτείται σύνδεση' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: 'Απαιτούνται δικαιώματα γενικού διαχειριστή' });
    return;
  }

  next();
};
