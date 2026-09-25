/**
 * Εξαγωγή αναφορών @username από κείμενο σχολίου. Χρησιμοποιείται και από τον client
 * (οπτική επισήμανση) και από τον server (ειδοποιήσεις) — ένα σημείο, ώστε να
 * ταιριάζουν πάντα απόλυτα.
 *
 * Δεν μαντεύουμε πού τελειώνει ένα όνομα με regex: τα ονόματα χρήστη μπορεί να έχουν
 * κενά ("Yankee Dio") ή ελληνικούς χαρακτήρες ("Κώστας"). Αντί γι' αυτό, μετά από κάθε
 * @ δοκιμάζουμε τα πραγματικά ονόματα μελών, το μακρύτερο πρώτα.
 */

/** Γράμμα ή ψηφίο οποιουδήποτε αλφαβήτου, ή κάτω παύλα. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

interface MentionMatch {
  index: number;
  length: number;
  username: string;
}

function findMentions(body: string, validUsernames: ReadonlySet<string>): MentionMatch[] {
  const candidates = Array.from(validUsernames)
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  const matches: MentionMatch[] = [];

  let at = body.indexOf('@');
  while (at !== -1) {
    // Ένα @ μέσα σε λέξη (π.χ. user@domain.com) δεν είναι αναφορά.
    const before = at > 0 ? body[at - 1] : '';
    const username = before && WORD_CHAR.test(before)
      ? undefined
      : candidates.find((name) => {
          if (!body.startsWith(name, at + 1)) return false;
          const after = body[at + 1 + name.length];
          return after === undefined || !WORD_CHAR.test(after);
        });

    if (username) {
      matches.push({ index: at, length: username.length + 1, username });
      at = body.indexOf('@', at + 1 + username.length);
    } else {
      at = body.indexOf('@', at + 1);
    }
  }

  return matches;
}

/**
 * Επιστρέφει τα μοναδικά, έγκυρα ονόματα χρήστη (μέλη του project) που αναφέρονται
 * στο κείμενο — αγνοεί οτιδήποτε δεν αντιστοιχεί σε πραγματικό μέλος.
 */
export function extractMentions(body: string, validUsernames: ReadonlySet<string>): string[] {
  return Array.from(new Set(findMentions(body, validUsernames).map((m) => m.username)));
}

/** Ένα κομμάτι κειμένου σχολίου: είτε απλό κείμενο είτε μια έγκυρη αναφορά. */
export type MentionSegment = { type: 'text'; text: string } | { type: 'mention'; username: string };

/**
 * Σπάει το κείμενο σε κομμάτια για rendering, ξεχωρίζοντας τις έγκυρες αναφορές από το
 * υπόλοιπο κείμενο — ίδιος εντοπισμός με το extractMentions, ώστε η οπτική επισήμανση
 * στον client να ταιριάζει ακριβώς με το ποιος πραγματικά ειδοποιείται.
 */
export function splitMentions(body: string, validUsernames: ReadonlySet<string>): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;

  for (const match of findMentions(body, validUsernames)) {
    if (match.index > lastIndex) segments.push({ type: 'text', text: body.slice(lastIndex, match.index) });
    segments.push({ type: 'mention', username: match.username });
    lastIndex = match.index + match.length;
  }

  if (lastIndex < body.length) segments.push({ type: 'text', text: body.slice(lastIndex) });
  return segments;
}
