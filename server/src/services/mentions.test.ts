import { describe, it, expect } from 'vitest';
import { extractMentions, splitMentions } from '@metafrasis/shared';

const MEMBERS = new Set(['kostas', 'maria', 'giannis']);

describe('extractMentions', () => {
  it('εξάγει μια έγκυρη αναφορά', () => {
    expect(extractMentions('Γεια σου @kostas, δες αυτό', MEMBERS)).toEqual(['kostas']);
  });

  it('αγνοεί ονόματα που δεν αντιστοιχούν σε μέλος', () => {
    expect(extractMentions('Γεια σου @agnostos', MEMBERS)).toEqual([]);
  });

  it('εξάγει πολλαπλές αναφορές στο ίδιο κείμενο', () => {
    expect(extractMentions('@kostas και @maria δείτε αυτό', MEMBERS)).toEqual(['kostas', 'maria']);
  });

  it('δεν επαναλαμβάνει την ίδια αναφορά δύο φορές', () => {
    expect(extractMentions('@kostas ... @kostas ξανά', MEMBERS)).toEqual(['kostas']);
  });

  it('δεν ταιριάζει σε email address σαν αναφορά σε μέλος', () => {
    // "user@domain.com" ταιριάζει τεχνικά ως @domain, αλλά "domain" δεν είναι μέλος.
    expect(extractMentions('Στείλε στο user@domain.com', MEMBERS)).toEqual([]);
  });

  it('εξάγει αυτο-αναφορά κανονικά — ο αποκλεισμός γίνεται στον server, όχι εδώ', () => {
    expect(extractMentions('@kostas εγώ ο ίδιος', MEMBERS)).toEqual(['kostas']);
  });

  it('κείμενο χωρίς αναφορές δίνει άδειο πίνακα', () => {
    expect(extractMentions('Απλό κείμενο χωρίς τίποτα', MEMBERS)).toEqual([]);
  });

  const MIXED = new Set(['Yankee Dio', 'Yankee', 'Asxe', 'Κώστας']);

  it('αναγνωρίζει ονόματα με κενό', () => {
    expect(extractMentions('Πως @Yankee Dio @Asxe πως να μεταφραστεί;', MIXED)).toEqual(['Yankee Dio', 'Asxe']);
  });

  it('προτιμά το μακρύτερο όνομα που ταιριάζει', () => {
    expect(extractMentions('@Yankee Dio και @Yankee', MIXED)).toEqual(['Yankee Dio', 'Yankee']);
  });

  it('αναγνωρίζει ελληνικά ονόματα', () => {
    expect(extractMentions('Ρώτα τον @Κώστας.', MIXED)).toEqual(['Κώστας']);
  });

  it('δεν ταιριάζει όταν το όνομα συνεχίζει με γράμμα ή ψηφίο', () => {
    expect(extractMentions('@Asxe2 και @Κώσταςς', MIXED)).toEqual([]);
  });

  it('δεν θεωρεί αναφορά ένα @ μέσα σε λέξη', () => {
    expect(extractMentions('γράψε στο info@maria.gr', MEMBERS)).toEqual([]);
  });
});

describe('splitMentions', () => {
  it('σπάει το κείμενο σε text/mention κομμάτια', () => {
    expect(splitMentions('Γεια @kostas!', MEMBERS)).toEqual([
      { type: 'text', text: 'Γεια ' },
      { type: 'mention', username: 'kostas' },
      { type: 'text', text: '!' },
    ]);
  });

  it('κείμενο χωρίς έγκυρες αναφορές μένει ένα ενιαίο κομμάτι', () => {
    expect(splitMentions('Γεια @agnostos!', MEMBERS)).toEqual([
      { type: 'text', text: 'Γεια @agnostos!' },
    ]);
  });

  it('πολλαπλές αναφορές παράγουν εναλλασσόμενα κομμάτια', () => {
    expect(splitMentions('@kostas και @maria', MEMBERS)).toEqual([
      { type: 'mention', username: 'kostas' },
      { type: 'text', text: ' και ' },
      { type: 'mention', username: 'maria' },
    ]);
  });
});
