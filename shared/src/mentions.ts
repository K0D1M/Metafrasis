/**
 * Εξαγωγή αναφορών @username από κείμενο σχολίου. Χρησιμοποιείται και από τον client
 * (οπτική επισήμανση) και από τον server (ειδοποιήσεις) — ένα regex, ένα σημείο, ώστε
 * να ταιριάζουν πάντα απόλυτα.
 */

/** @ ακολουθούμενο από χαρακτήρες λέξης (γράμματα/αριθμοί/κάτω παύλα) — ίδιοι κανόνες
 * με τα ονόματα χρήστη αυτής της εφαρμογής. Ένα "@" μέσα σε email (user@domain.com)
 * ταιριάζει ως @domain, αλλά απορρίπτεται παρακάτω αφού δεν αντιστοιχεί σε μέλος. */
const MENTION_PATTERN = /@(\w+)/g;

/**
 * Επιστρέφει τα μοναδικά, έγκυρα ονόματα χρήστη (μέλη του project) που αναφέρονται
 * στο κείμενο — αγνοεί οτιδήποτε δεν αντιστοιχεί σε πραγματικό μέλος.
 */
export function extractMentions(body: string, validUsernames: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const username = match[1];
    if (username && validUsernames.has(username)) found.add(username);
  }
  return Array.from(found);
}

/** Ένα κομμάτι κειμένου σχολίου: είτε απλό κείμενο είτε μια έγκυρη αναφορά. */
export type MentionSegment = { type: 'text'; text: string } | { type: 'mention'; username: string };

/**
 * Σπάει το κείμενο σε κομμάτια για rendering, ξεχωρίζοντας τις έγκυρες αναφορές από το
 * υπόλοιπο κείμενο — ίδιο MENTION_PATTERN με το extractMentions, ώστε η οπτική
 * επισήμανση στον client να ταιριάζει ακριβώς με το ποιος πραγματικά ειδοποιείται.
 */
export function splitMentions(body: string, validUsernames: ReadonlySet<string>): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const username = match[1];
    const index = match.index ?? 0;
    if (!username || !validUsernames.has(username)) continue;

    if (index > lastIndex) segments.push({ type: 'text', text: body.slice(lastIndex, index) });
    segments.push({ type: 'mention', username });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < body.length) segments.push({ type: 'text', text: body.slice(lastIndex) });
  return segments;
}
