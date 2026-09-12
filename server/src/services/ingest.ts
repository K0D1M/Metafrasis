/**
 * Εισαγωγή και Ενημέρωση αρχείων JSON.
 *
 * Κανόνας που δεν παραβιάζεται ποτέ: μια Ενημέρωση δεν διαγράφει ποτέ μετάφραση.
 * Δες ingest.test.ts.
 */
import { flatten, type JsonValue } from './jsonFlatten.js';

export interface ExistingString {
  key: string;
  sourceText: string;
}

/** Τι πρέπει να αλλάξει στη βάση μετά από μια Ενημέρωση. */
export interface IngestPlan {
  /** Νέα κλειδιά που δεν υπήρχαν στην προηγούμενη αναθεώρηση. */
  added: Array<{ key: string; sourceText: string; order: number }>;
  /** Υπάρχοντα κλειδιά με αμετάβλητο πρωτότυπο — ενημερώνεται μόνο η σειρά. */
  unchanged: Array<{ key: string; order: number }>;
  /**
   * Υπάρχοντα κλειδιά όπου άλλαξε το πρωτότυπο. Η μετάφραση διατηρείται αλλά
   * σημαιοδοτείται ως needsReview: ο μεταφραστής πρέπει να δει ότι η βάση μετακινήθηκε.
   */
  changed: Array<{ key: string; sourceText: string; order: number }>;
  /**
   * Κλειδιά που έλειπαν από το νέο αρχείο. Σημαιοδοτούνται ως removed αλλά
   * ΔΕΝ διαγράφονται — μπορεί να επανέλθουν σε επόμενη αναθεώρηση μαζί με τη μετάφρασή τους.
   */
  removed: string[];
  /** Κλειδιά που είχαν σημανθεί removed και εμφανίστηκαν ξανά. */
  restored: string[];
}

/**
 * Συγκρίνει το νέο περιεχόμενο με τα υπάρχοντα κείμενα και παράγει το σχέδιο αλλαγών.
 *
 * @param newContent Το JSON που μόλις ανέβηκε.
 * @param existing   Τα κείμενα που υπάρχουν ήδη στη βάση για το αρχείο.
 * @param removedKeys Ποια από αυτά είναι ήδη σημασμένα ως removed.
 */
export function planIngest(
  newContent: JsonValue,
  existing: ExistingString[],
  removedKeys: ReadonlySet<string> = new Set(),
): IngestPlan {
  const incoming = flatten(newContent).strings;
  const existingByKey = new Map(existing.map((s) => [s.key, s]));
  const incomingKeys = new Set(incoming.map((s) => s.key));

  const plan: IngestPlan = {
    added: [],
    unchanged: [],
    changed: [],
    removed: [],
    restored: [],
  };

  for (const item of incoming) {
    const prior = existingByKey.get(item.key);

    if (!prior) {
      plan.added.push({ key: item.key, sourceText: item.value, order: item.order });
      continue;
    }

    if (removedKeys.has(item.key)) {
      plan.restored.push(item.key);
    }

    if (prior.sourceText === item.value) {
      plan.unchanged.push({ key: item.key, order: item.order });
    } else {
      plan.changed.push({ key: item.key, sourceText: item.value, order: item.order });
    }
  }

  for (const prior of existing) {
    if (!incomingKeys.has(prior.key) && !removedKeys.has(prior.key)) {
      plan.removed.push(prior.key);
    }
  }

  return plan;
}

/** Διαβάζει και επικυρώνει ανεβασμένο JSON, με μηνύματα κατανοητά στον χρήστη. */
export function parseJsonUpload(buffer: Buffer): JsonValue {
  let text = buffer.toString('utf8');

  // Τα αρχεία που εξάγουν εργαλεία των Windows ξεκινούν συχνά με BOM, που σπάει το JSON.parse.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Το αρχείο δεν είναι έγκυρο JSON: ${detail}`);
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Το αρχείο πρέπει να περιέχει αντικείμενο ή πίνακα JSON');
  }

  return parsed as JsonValue;
}
