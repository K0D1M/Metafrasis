import { z } from 'zod';

export { extractMentions, splitMentions, type MentionSegment } from './mentions.js';

/* ── Ρόλοι ─────────────────────────────────────────────────────────────────── */

export const Role = {
  MANAGER: 'MANAGER',
  TRANSLATOR: 'TRANSLATOR',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const roleSchema = z.enum([Role.MANAGER, Role.TRANSLATOR]);

/** Ετικέτες ρόλων στα ελληνικά, για το UI. */
export const roleLabels: Record<Role, string> = {
  MANAGER: 'Διαχειριστής',
  TRANSLATOR: 'Μεταφραστής',
};

/* ── Γλώσσες ───────────────────────────────────────────────────────────────── */

export const LANGUAGES = [
  { code: 'en', label: 'Αγγλικά' },
  { code: 'el', label: 'Ελληνικά' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

/* ── Αυθεντικοποίηση ───────────────────────────────────────────────────────── */

export const loginSchema = z.object({
  /** Δέχεται είτε email είτε όνομα χρήστη — και τα δύο είναι μοναδικά στη βάση. */
  identifier: z.string().min(1, 'Απαιτείται email ή όνομα χρήστη'),
  password: z.string().min(1, 'Απαιτείται κωδικός'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email('Μη έγκυρο email'),
  username: z.string().min(2, 'Τουλάχιστον 2 χαρακτήρες').max(40),
  password: z.string().min(8, 'Τουλάχιστον 8 χαρακτήρες'),
  /** Παρόν όταν ο χρήστης έρχεται από σύνδεσμο πρόσκλησης. */
  inviteToken: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/* ── Επαναφορά κωδικού ─────────────────────────────────────────────────────── */

export const requestPasswordResetSchema = z.object({
  identifier: z.string().min(1, 'Απαιτείται email ή όνομα χρήστη'),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Λείπει το token'),
  password: z.string().min(8, 'Τουλάχιστον 8 χαρακτήρες'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export interface PasswordResetResult {
  /** Ο σύνδεσμος που εμφανίζεται στην οθόνη — χωρίς SMTP, όπως και οι προσκλήσεις μελών. */
  url: string;
  expiresAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

/* ── Projects ──────────────────────────────────────────────────────────────── */

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Απαιτείται όνομα').max(100),
  sourceLanguage: z.string().min(2),
  targetLanguages: z.array(z.string().min(2)).min(1, 'Επίλεξε τουλάχιστον μία γλώσσα'),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export interface ProjectSummary {
  id: string;
  name: string;
  sourceLanguage: string;
  targetLanguages: string[];
  role: Role;
  progress: ProgressStats;
  createdAt: string;
}

/* ── Πρόοδος ───────────────────────────────────────────────────────────────── */

export interface ProgressStats {
  total: number;
  translated: number;
  /** Ποσοστό 0–100, στρογγυλοποιημένο. */
  percent: number;
}

/* ── Πηγές: φάκελοι και αρχεία ─────────────────────────────────────────────── */

export const createFolderSchema = z.object({
  name: z.string().min(1, 'Απαιτείται όνομα').max(100),
  parentId: z.string().nullable().optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

export interface SourceFileSummary {
  id: string;
  name: string;
  folderId: string | null;
  /** Σύνολο μεταφράσιμων κειμένων — η στήλη "Strings". */
  stringCount: number;
  /** Πλήθος αναθεωρήσεων — η στήλη "Revision". */
  revision: number;
  progress: ProgressStats;
  updatedAt: string;
  updatedBy: { id: string; username: string } | null;
}

/** Στάδιο ενεργού ανεβάσματος αρχείου, όπως παρακολουθείται στη μνήμη του server. */
export type UploadJobStage = 'parsing' | 'diffing' | 'saving' | 'done' | 'error';

export interface UploadJob {
  projectId: string;
  fileName: string;
  stage: UploadJobStage;
  error?: string;
  /** Παρόν μόνο για Ενημέρωση υπάρχοντος αρχείου· απόν για νέο ανέβασμα (add). */
  fileId?: string;
}

/* ── Κείμενα και μεταφράσεις ───────────────────────────────────────────────── */

export interface SourceStringView {
  id: string;
  key: string;
  sourceText: string;
  order: number;
  needsReview: boolean;
  removed: boolean;
  translation: string | null;
  commentCount: number;
}

export const saveTranslationSchema = z.object({
  text: z.string(),
  language: z.string().min(2),
});
export type SaveTranslationInput = z.infer<typeof saveTranslationSchema>;

/* ── Σχόλια ────────────────────────────────────────────────────────────────── */

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Το σχόλιο δεν μπορεί να είναι κενό').max(4000),
  parentId: z.string().nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string; avatarUrl: string | null };
  replies: CommentView[];
}

/* ── Μέλη και προσκλήσεις ──────────────────────────────────────────────────── */

export interface MemberView {
  userId: string;
  username: string;
  /** Ορατό μόνο σε διαχειριστές του project — null για τους υπόλοιπους. */
  email: string | null;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

/* ── Γενική διαχείριση (admin dashboard) ──────────────────────────────────────
 * Ξεχωριστά από τα ProjectSummary/MemberView: εδώ το email είναι πάντα ορατό (μόνο
 * γενικός διαχειριστής βλέπει αυτά τα endpoints) — διαφορετικό συμβόλαιο ορατότητας
 * από αυτό που εφαρμόζεται στα μέλη ενός project μεταξύ τους. */

export interface AdminProjectView {
  id: string;
  name: string;
  sourceLanguage: string;
  targetLanguages: string[];
  createdAt: string;
  progress: ProgressStats;
  members: Array<{
    userId: string;
    username: string;
    email: string;
    avatarUrl: string | null;
    role: Role;
    joinedAt: string;
  }>;
}

export interface AdminUserView {
  id: string;
  /** Το πραγματικό username — δεν εφαρμόζεται εδώ η μεταμφίεση deactivated_user_<id>. */
  username: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  memberships: Array<{ projectId: string; projectName: string; role: Role }>;
}

export const inviteSchema = z.object({
  email: z.string().email('Μη έγκυρο email'),
  role: roleSchema,
  message: z.string().max(1000).optional(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export interface InviteResult {
  /** Ο σύνδεσμος που αντιγράφει ο διαχειριστής και στέλνει στο μέλος. */
  url: string;
  email: string;
  role: Role;
  expiresAt: string;
}

/* ── Στιγμιότυπα ───────────────────────────────────────────────────────────── */

/** 5 MB: χωράει άνετα ένα 4K PNG χωρίς να γεμίζει ο δίσκος με λίγα ανεβάσματα. */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export interface ScreenshotView {
  id: string;
  url: string;
  /** Ίδιο αρχείο, χωρίς επεξεργασία — μόνο Content-Disposition: attachment. */
  downloadUrl: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploader: { id: string; username: string; avatarUrl: string | null };
  comment: string | null;
}

/* ── Εργασίες ──────────────────────────────────────────────────────────────── */

export const TaskStatus = { OPEN: 'OPEN', DONE: 'DONE' } as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Απαιτείται τίτλος').max(150),
  description: z.string().max(4000).optional(),
  assigneeId: z.string().min(1, 'Επίλεξε μέλος'),
  fileIds: z.array(z.string()).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt: string;
  completedAt: string | null;
  assignee: { id: string; username: string; avatarUrl: string | null };
  createdBy: { id: string; username: string };
  files: Array<{ id: string; name: string }>;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; username: string; avatarUrl: string | null };
  }>;
}

/* ── Αναφορές QA ───────────────────────────────────────────────────────────── */

export const QaSeverity = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' } as const;
export type QaSeverity = (typeof QaSeverity)[keyof typeof QaSeverity];

export const qaSeverityLabels: Record<QaSeverity, string> = {
  LOW: 'Χαμηλή',
  MEDIUM: 'Μεσαία',
  HIGH: 'Υψηλή',
};

export const QaStatus = { OPEN: 'OPEN', RESOLVED: 'RESOLVED' } as const;
export type QaStatus = (typeof QaStatus)[keyof typeof QaStatus];

export const createQaReportSchema = z.object({
  title: z.string().min(1, 'Απαιτείται τίτλος').max(150),
  description: z.string().min(1, 'Απαιτείται περιγραφή').max(4000),
  severity: z.enum([QaSeverity.LOW, QaSeverity.MEDIUM, QaSeverity.HIGH]),
  stringId: z.string().nullable().optional(),
});
export type CreateQaReportInput = z.infer<typeof createQaReportSchema>;

export interface QaReportView {
  id: string;
  title: string;
  description: string;
  severity: QaSeverity;
  status: QaStatus;
  createdAt: string;
  resolvedAt: string | null;
  author: { id: string; username: string; avatarUrl: string | null };
  resolvedBy: { id: string; username: string } | null;
  string: { id: string; key: string; fileName: string } | null;
  screenshot: { url: string; originalName: string } | null;
}

/* ── Δραστηριότητα ─────────────────────────────────────────────────────────── */

/** Σταθερά αναγνωριστικά· το UI τα μεταφράζει, ώστε τα logs να μένουν σταθερά. */
export const ActivityAction = {
  PROJECT_CREATE: 'project.create',
  FILE_UPLOAD: 'file.upload',
  FILE_UPDATE: 'file.update',
  FILE_DELETE: 'file.delete',
  FOLDER_CREATE: 'folder.create',
  TRANSLATION_SAVE: 'translation.save',
  COMMENT_ADD: 'comment.add',
  MEMBER_INVITE: 'member.invite',
  MEMBER_JOIN: 'member.join',
  MEMBER_UPDATE: 'member.update',
  MEMBER_REMOVE: 'member.remove',
  SCREENSHOT_UPLOAD: 'screenshot.upload',
  SCREENSHOT_DELETE: 'screenshot.delete',
  TASK_CREATE: 'task.create',
  TASK_COMPLETE: 'task.complete',
  QA_CREATE: 'qa.create',
  QA_RESOLVE: 'qa.resolve',
  SETTINGS_UPDATE: 'settings.update',
} as const;

export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];

export interface ActivityView {
  id: string;
  action: string;
  target: string | null;
  createdAt: string;
  user: { id: string; username: string; avatarUrl: string | null };
}

/* ── Ειδοποιήσεις ──────────────────────────────────────────────────────────── */

/**
 * Σταθερά αναγνωριστικά για ειδοποιήσεις ανά μέλος — παράλληλο λεξιλόγιο με το
 * ActivityAction, που είναι κοινό log για όλο το project. Ίδιες τιμές string όπου
 * αφορούν το ίδιο γεγονός (π.χ. "file.upload"), ώστε να μη χρειάζονται δύο λεξιλόγια.
 */
export const NotificationType = {
  TASK_ASSIGN: 'task.assign',
  COMMENT_REPLY: 'comment.reply',
  COMMENT_MENTION: 'comment.mention',
  QA_CREATE: ActivityAction.QA_CREATE,
  QA_RESOLVE: ActivityAction.QA_RESOLVE,
  FILE_UPLOAD: ActivityAction.FILE_UPLOAD,
  FILE_UPDATE: ActivityAction.FILE_UPDATE,
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export interface NotificationView {
  id: string;
  projectId: string;
  projectName: string;
  type: string;
  target: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/* ── Ρυθμίσεις ─────────────────────────────────────────────────────────────── */

export const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  activityVisibleToAll: z.boolean().optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/* ── Σφάλματα API ──────────────────────────────────────────────────────────── */

export interface ApiError {
  error: string;
  /** Σφάλματα ανά πεδίο, για φόρμες. */
  fields?: Record<string, string>;
}
