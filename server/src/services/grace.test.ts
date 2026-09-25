/**
 * Λογική χρόνου χάριτος της λίστας «Μη μεταφρασμένα» (client/src/pages/StringEditor.tsx).
 * Αντιγράφει τον ίδιο κανόνα εδώ ώστε να ελέγχεται χωρίς browser — η συμπεριφορά που
 * μας ενδιαφέρει είναι καθαρή λογική πάνω σε δεδομένα, όχι DOM.
 */
import { describe, it, expect } from 'vitest';

const LANGUAGE_SCRIPTS: Record<string, RegExp> = {
  el: /[Ͱ-Ͽἀ-῿]/,
  en: /[a-zA-Z]/,
};

interface Item {
  id: string;
  translation: string | null;
  skipped: boolean;
  needsReview: boolean;
}

function isActuallyTranslated(text: string | null | undefined, language: string): boolean {
  if (!text || !text.trim()) return false;
  const script = LANGUAGE_SCRIPTS[language];
  return script ? script.test(text) : text.trim().length > 0;
}

function isDone(item: Item, language: string): boolean {
  if (item.needsReview) return false;
  return item.skipped || isActuallyTranslated(item.translation, language);
}

const GRACE_MS = 15_000;

/** Ίδιο φίλτρο με το visible useMemo του StringEditor. */
function untranslatedView(items: Item[], language: string, grace: Map<string, number>, now: number): Item[] {
  for (const [id, expiresAt] of grace) {
    if (expiresAt <= now) grace.delete(id);
  }
  return items.filter((s) => !isDone(s, language) || grace.has(s.id));
}

/** Ίδια μετάβαση με το updateLocal του StringEditor. */
function applyPatch(items: Item[], id: string, patch: Partial<Item>, language: string, grace: Map<string, number>, now: number): Item[] {
  return items.map((s) => {
    if (s.id !== id) return s;
    const updated = { ...s, ...patch };
    if (!isDone(s, language) && isDone(updated, language)) {
      grace.set(id, now + GRACE_MS);
    } else if (!isDone(updated, language)) {
      grace.delete(id);
    }
    return updated;
  });
}

describe('χρόνος χάριτος στη λίστα «Μη μεταφρασμένα»', () => {
  const base: Item[] = [
    { id: 'a', translation: null, skipped: false, needsReview: false },
    { id: 'b', translation: null, skipped: false, needsReview: false },
  ];

  it('ένα μόλις μεταφρασμένο κείμενο παραμένει ορατό αμέσως μετά την αποθήκευση', () => {
    const grace = new Map<string, number>();
    const t0 = 1_000_000;
    const after = applyPatch(base, 'a', { translation: 'Γεια' }, 'el', grace, t0);
    expect(untranslatedView(after, 'el', grace, t0).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('παραμένει ορατό λίγο πριν λήξει η χάρη', () => {
    const grace = new Map<string, number>();
    const t0 = 1_000_000;
    const after = applyPatch(base, 'a', { translation: 'Γεια' }, 'el', grace, t0);
    expect(untranslatedView(after, 'el', grace, t0 + GRACE_MS - 1).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('εξαφανίζεται μόλις λήξει η χάρη', () => {
    const grace = new Map<string, number>();
    const t0 = 1_000_000;
    const after = applyPatch(base, 'a', { translation: 'Γεια' }, 'el', grace, t0);
    expect(untranslatedView(after, 'el', grace, t0 + GRACE_MS).map((s) => s.id)).toEqual(['b']);
  });

  it('διόρθωση μέσα στη χάρη το κρατά ορατό, με νέα προθεσμία', () => {
    const grace = new Map<string, number>();
    const t0 = 1_000_000;
    let items = applyPatch(base, 'a', { translation: 'Γεια' }, 'el', grace, t0);
    // Ο μεταφραστής διορθώνει 5 δευτερόλεπτα αργότερα — παραμένει done, η χάρη δεν ανανεώνεται
    // (δεν υπάρχει μετάβαση not-done -> done), αλλά δεν χάνεται κιόλας πριν την αρχική λήξη.
    items = applyPatch(items, 'a', { translation: 'Γεια σου' }, 'el', grace, t0 + 5_000);
    expect(untranslatedView(items, 'el', grace, t0 + 6_000).map((s) => s.id)).toEqual(['a', 'b']);
    expect(untranslatedView(items, 'el', grace, t0 + GRACE_MS).map((s) => s.id)).toEqual(['b']);
  });

  it('αν σβηστεί ξανά η μετάφραση, το κείμενο επιστρέφει κανονικά στη λίστα χωρίς χάρη', () => {
    const grace = new Map<string, number>();
    const t0 = 1_000_000;
    let items = applyPatch(base, 'a', { translation: 'Γεια' }, 'el', grace, t0);
    items = applyPatch(items, 'a', { translation: '' }, 'el', grace, t0 + 2_000);
    expect(grace.has('a')).toBe(false);
    expect(untranslatedView(items, 'el', grace, t0 + 2_000).map((s) => s.id)).toEqual(['a', 'b']);
    // Και παραμένει ορατό πολύ μετά τη λήξη της παλιάς χάρης.
    expect(untranslatedView(items, 'el', grace, t0 + 60_000).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('«δεν χρειάζεται μετάφραση» παίρνει επίσης χρόνο χάριτος', () => {
    const grace = new Map<string, number>();
    const t0 = 1_000_000;
    const items = applyPatch(base, 'a', { skipped: true }, 'el', grace, t0);
    expect(untranslatedView(items, 'el', grace, t0 + 1_000).map((s) => s.id)).toEqual(['a', 'b']);
    expect(untranslatedView(items, 'el', grace, t0 + GRACE_MS).map((s) => s.id)).toEqual(['b']);
  });

  it('μετάφραση που υπήρχε ήδη κατά τη φόρτωση δεν εμφανίζεται καθόλου', () => {
    const grace = new Map<string, number>();
    const items: Item[] = [
      { id: 'a', translation: 'Γεια', skipped: false, needsReview: false },
      { id: 'b', translation: null, skipped: false, needsReview: false },
    ];
    expect(untranslatedView(items, 'el', grace, 1_000_000).map((s) => s.id)).toEqual(['b']);
  });

  it('κείμενο σε «Χρειάζεται έλεγχος» παραμένει στη λίστα ανεξάρτητα από τη χάρη', () => {
    const grace = new Map<string, number>();
    const items: Item[] = [{ id: 'a', translation: 'Γεια', skipped: false, needsReview: true }];
    expect(untranslatedView(items, 'el', grace, 1_000_000).map((s) => s.id)).toEqual(['a']);
  });
});
