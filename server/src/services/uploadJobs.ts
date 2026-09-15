/**
 * Παρακολούθηση ενεργών ανεβασμάτων στη μνήμη, ανά project — επιτρέπει σε μια σελίδα
 * που ανανεώθηκε να ρωτήσει "τρέχει κάτι ακόμα;" αντί να χάνει την ένδειξη προόδου.
 * Δεν επιβιώνει σε επανεκκίνηση του server (μόνο σε ανανέωση σελίδας) — βλ. σχέδιο.
 */
import type { UploadJob, UploadJobStage } from '@metafrasis/shared';

export type { UploadJob, UploadJobStage };

const jobs = new Map<string, UploadJob>();

export function startJob(projectId: string, fileName: string): void {
  jobs.set(projectId, { fileName, stage: 'parsing' });
}

export function updateJob(projectId: string, stage: UploadJobStage, error?: string): void {
  const job = jobs.get(projectId);
  if (job) {
    job.stage = stage;
    if (error) job.error = error;
  }
}

export function finishJob(projectId: string): void {
  // Κρατάμε την τελική κατάσταση λίγο ακόμα, ώστε ένας client που κάνει polling να
  // προλάβει να τη δει μία φορά, μετά την καθαρίζουμε ώστε να μη μείνει "φάντασμα".
  setTimeout(() => jobs.delete(projectId), 5000);
}

export function getJob(projectId: string): UploadJob | undefined {
  return jobs.get(projectId);
}
