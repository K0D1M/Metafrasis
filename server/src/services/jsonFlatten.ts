/**
 * Μετατροπή εμφωλευμένων JSON αρχείων παιχνιδιού σε επίπεδη λίστα μεταφράσιμων κειμένων
 * και πίσω.
 *
 * Αυτό είναι το πιο κρίσιμο αρχείο του project: αν το round-trip δεν είναι ακριβές,
 * κάθε εξαγωγή καταστρέφει σιωπηλά τα αρχεία του παιχνιδιού. Δες jsonFlatten.test.ts.
 */

/** Τιμή που μπορεί να υπάρχει σε ένα JSON αρχείο. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Ένα μεταφράσιμο κείμενο με τη διαδρομή του μέσα στο αρχείο. */
export interface FlatString {
  /** Διαδρομή κλειδιού, π.χ. "chapter1.intro.line1" ή "menu.items.0". */
  key: string;
  /** Το πρωτότυπο κείμενο. */
  value: string;
  /** Σειρά εμφάνισης στο αρχείο, ώστε ο editor να διατηρεί τη φυσική ροή. */
  order: number;
}

/**
 * Ό,τι δεν είναι κείμενο (αριθμοί, booleans, null) δεν μεταφράζεται, αλλά πρέπει να
 * επιστρέψει αυτούσιο στην εξαγωγή. Το κρατάμε χωριστά από τα μεταφράσιμα.
 */
export interface FlattenResult {
  strings: FlatString[];
  /** Μη μεταφράσιμα φύλλα, με την ίδια μορφή διαδρομής. */
  passthrough: Array<{ key: string; value: number | boolean | null }>;
  /**
   * Διαδρομές που δείχνουν σε άδειο αντικείμενο ή άδειο πίνακα. Χωρίς αυτές, ένα
   * `{"a":{}}` θα χανόταν εντελώς στο round-trip.
   */
  empties: Array<{ key: string; kind: 'object' | 'array' }>;
}

/**
 * Τα κλειδιά του παιχνιδιού μπορεί να περιέχουν τελεία (π.χ. "npc.name"), που είναι και
 * ο διαχωριστής μας. Κάνουμε escape ώστε η διαδρομή να αποκωδικοποιείται μονοσήμαντα:
 * "\" -> "\\" και "." -> "\.".
 */
export function escapeSegment(segment: string): string {
  return segment.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
}

export function unescapeSegment(segment: string): string {
  return segment.replace(/\\([\\.])/g, '$1');
}

/** Ενώνει τμήματα διαδρομής σε ένα κλειδί. */
export function joinKey(segments: string[]): string {
  return segments.map(escapeSegment).join('.');
}

/**
 * Σπάει ένα κλειδί στα τμήματά του, σεβόμενο τα escaped σημεία.
 * Το "a\.b.c" δίνει ["a.b", "c"] — δύο τμήματα, όχι τρία.
 */
export function splitKey(key: string): string[] {
  const segments: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of key) {
    if (escaped) {
      current += char === '\\' || char === '.' ? char : `\\${char}`;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '.') {
      segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  // Μια διαδρομή που τελειώνει σε backslash είναι κακοσχηματισμένη· τον κρατάμε αυτούσιο
  // αντί να τον καταπιούμε σιωπηλά.
  if (escaped) current += '\\';
  segments.push(current);

  return segments;
}

/**
 * Επίπεδη ανάγνωση ενός JSON αρχείου, με σειρά εμφάνισης (depth-first).
 * Οι πίνακες διατρέχονται με αριθμητικά τμήματα διαδρομής.
 */
export function flatten(root: JsonValue): FlattenResult {
  const strings: FlatString[] = [];
  const passthrough: FlattenResult['passthrough'] = [];
  const empties: FlattenResult['empties'] = [];
  let order = 0;

  const walk = (node: JsonValue, path: string[]): void => {
    if (typeof node === 'string') {
      strings.push({ key: joinKey(path), value: node, order: order++ });
      return;
    }

    if (node === null || typeof node === 'number' || typeof node === 'boolean') {
      passthrough.push({ key: joinKey(path), value: node });
      return;
    }

    if (Array.isArray(node)) {
      if (node.length === 0) {
        empties.push({ key: joinKey(path), kind: 'array' });
        return;
      }
      node.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }

    const entries = Object.entries(node);
    if (entries.length === 0) {
      empties.push({ key: joinKey(path), kind: 'object' });
      return;
    }
    for (const [key, value] of entries) {
      walk(value, [...path, key]);
    }
  };

  walk(root, []);
  return { strings, passthrough, empties };
}

/** Ένα τμήμα διαδρομής μετρά ως δείκτης πίνακα μόνο αν είναι κανονικός μη-αρνητικός ακέραιος. */
function isArrayIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

interface UnflattenEntry {
  key: string;
  value: JsonValue;
}

/**
 * Ανακατασκευάζει την αρχική εμφωλευμένη δομή.
 *
 * Περνάμε τις μεταφράσεις εκεί που υπάρχουν· όπου λείπουν, χρησιμοποιείται το πρωτότυπο,
 * ώστε μια μερική μετάφραση να παράγει πάντα έγκυρο αρχείο παιχνιδιού.
 */
export function unflatten(result: FlattenResult, translations?: Map<string, string>): JsonValue {
  const entries: UnflattenEntry[] = [
    ...result.strings.map((s) => ({
      key: s.key,
      value: (translations?.get(s.key) ?? s.value) as JsonValue,
    })),
    ...result.passthrough.map((p) => ({ key: p.key, value: p.value as JsonValue })),
    ...result.empties.map((e) => ({
      key: e.key,
      value: (e.kind === 'array' ? [] : {}) as JsonValue,
    })),
  ];

  if (entries.length === 0) return {};

  // Μια διαδρομή με ένα κενό τμήμα σημαίνει ότι η ρίζα ήταν η ίδια φύλλο (π.χ. σκέτο string).
  const rootLeaf = entries.find((e) => e.key === '');
  if (rootLeaf && entries.length === 1) return rootLeaf.value;

  // Ο τύπος της ρίζας καθορίζεται από το πρώτο τμήμα της πρώτης διαδρομής.
  const firstSegments = splitKey(entries[0]!.key);
  const root: JsonValue = isArrayIndex(firstSegments[0]!) ? [] : {};

  for (const entry of entries) {
    const segments = splitKey(entry.key);
    let cursor: JsonValue = root;

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]!;
      const nextSegment = segments[i + 1]!;
      const container: JsonValue = isArrayIndex(nextSegment) ? [] : {};

      if (Array.isArray(cursor)) {
        const index = Number(segment);
        if (cursor[index] === undefined) cursor[index] = container;
        cursor = cursor[index]!;
      } else {
        const obj = cursor as { [key: string]: JsonValue };
        if (obj[segment] === undefined) obj[segment] = container;
        cursor = obj[segment]!;
      }
    }

    const last = segments[segments.length - 1]!;
    if (Array.isArray(cursor)) {
      cursor[Number(last)] = entry.value;
    } else {
      (cursor as { [key: string]: JsonValue })[last] = entry.value;
    }
  }

  return root;
}

/** Βοηθητικό: μετρά πόσα μεταφράσιμα κείμενα έχει ένα αρχείο. */
export function countStrings(root: JsonValue): number {
  return flatten(root).strings.length;
}
