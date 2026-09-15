/**
 * Παρακολούθηση ενεργών ανεβασμάτων στη μνήμη, ανά job — επιτρέπει σε μια σελίδα που
 * ανανεώθηκε να ρωτήσει "τρέχει κάτι ακόμα;" αντί να χάνει την ένδειξη προόδου.
 * Δεν επιβιώνει σε επανεκκίνηση του server (μόνο σε ανανέωση σελίδας) — βλ. σχέδιο.
 *
 * Κλειδί: "add:<projectId>" για νέο ανέβασμα αρχείου, "update:<fileId>" για Ενημέρωση —
 * ένα project μπορεί να έχει ταυτόχρονα ένα add ΚΑΙ πολλαπλά updates (διαφορετικοί
 * διαχειριστές, διαφορετικά αρχεία), γι' αυτό δεν αρκεί το projectId μόνο του ως κλειδί.
 */
import type { UploadJob, UploadJobStage } from '@metafrasis/shared';

export type { UploadJob, UploadJobStage };

const jobs = new Map<string, UploadJob>();

export function startJob(
  jobKey: string,
  info: { projectId: string; fileName: string; fileId?: string },
): void {
  jobs.set(jobKey, { ...info, stage: 'parsing' });
}

export function updateJob(jobKey: string, stage: UploadJobStage, error?: string): void {
  const job = jobs.get(jobKey);
  if (job) {
    job.stage = stage;
    if (error) job.error = error;
  }
}

export function finishJob(jobKey: string): void {
  // Κρατάμε την τελική κατάσταση λίγο ακόμα, ώστε ένας client που κάνει polling να
  // προλάβει να τη δει μία φορά, μετά την καθαρίζουμε ώστε να μη μείνει "φάντασμα".
  setTimeout(() => jobs.delete(jobKey), 5000);
}

export function getJob(jobKey: string): UploadJob | undefined {
  return jobs.get(jobKey);
}

/** Όλα τα ενεργά jobs ενός project — μπορεί να είναι περισσότερα από ένα ταυτόχρονα. */
export function getJobsForProject(projectId: string): UploadJob[] {
  return Array.from(jobs.values()).filter((job) => job.projectId === projectId);
}
