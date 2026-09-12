import { describe, it, expect } from 'vitest';
import {
  flatten,
  unflatten,
  splitKey,
  joinKey,
  countStrings,
  type JsonValue,
} from './jsonFlatten.js';

/** Το συμβόλαιο: ό,τι μπει, το ίδιο ακριβώς πρέπει να βγει. */
function expectRoundTrip(input: JsonValue): void {
  expect(unflatten(flatten(input))).toEqual(input);
}

describe('splitKey / joinKey', () => {
  it('κάνει round-trip απλά τμήματα', () => {
    expect(splitKey(joinKey(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  it('διατηρεί τελείες μέσα σε κλειδί', () => {
    const segments = ['npc.name', 'line'];
    expect(splitKey(joinKey(segments))).toEqual(segments);
  });

  it('διατηρεί backslash μέσα σε κλειδί', () => {
    const segments = ['path\\to', 'value'];
    expect(splitKey(joinKey(segments))).toEqual(segments);
  });

  it('χειρίζεται συνδυασμό backslash και τελείας', () => {
    const segments = ['a\\.b', 'c.d', 'e\\f'];
    expect(splitKey(joinKey(segments))).toEqual(segments);
  });

  it('διατηρεί κενά τμήματα', () => {
    expect(splitKey(joinKey(['a', '', 'b']))).toEqual(['a', '', 'b']);
  });
});

describe('flatten', () => {
  it('παράγει διαδρομές με τελεία για εμφωλευμένα αντικείμενα', () => {
    const result = flatten({ chapter1: { intro: { line1: 'Hello', line2: 'Goodbye' } } });
    expect(result.strings).toEqual([
      { key: 'chapter1.intro.line1', value: 'Hello', order: 0 },
      { key: 'chapter1.intro.line2', value: 'Goodbye', order: 1 },
    ]);
  });

  it('αριθμεί τα στοιχεία πίνακα', () => {
    const result = flatten({ menu: ['Νέο', 'Φόρτωση'] });
    expect(result.strings.map((s) => s.key)).toEqual(['menu.0', 'menu.1']);
  });

  it('ξεχωρίζει τα μη μεταφράσιμα φύλλα', () => {
    const result = flatten({ title: 'Παιχνίδι', version: 3, debug: false, extra: null });
    expect(result.strings.map((s) => s.key)).toEqual(['title']);
    expect(result.passthrough).toEqual([
      { key: 'version', value: 3 },
      { key: 'debug', value: false },
      { key: 'extra', value: null },
    ]);
  });

  it('διατηρεί τη σειρά εμφάνισης', () => {
    const result = flatten({ b: 'δεύτερο', a: 'πρώτο' });
    expect(result.strings.map((s) => s.order)).toEqual([0, 1]);
    expect(result.strings.map((s) => s.value)).toEqual(['δεύτερο', 'πρώτο']);
  });
});

describe('round-trip: unflatten(flatten(x)) === x', () => {
  it('επίπεδο αντικείμενο', () => {
    expectRoundTrip({ line1: 'Hello', line2: 'Goodbye' });
  });

  it('βαθιά εμφωλευμένο αντικείμενο', () => {
    expectRoundTrip({ a: { b: { c: { d: { e: 'βαθιά' } } } } });
  });

  it('πίνακες κειμένων', () => {
    expectRoundTrip({ menu: ['Νέο παιχνίδι', 'Φόρτωση', 'Έξοδος'] });
  });

  it('πίνακες αντικειμένων', () => {
    expectRoundTrip({
      dialogue: [
        { speaker: 'Άννα', text: 'Γεια σου.' },
        { speaker: 'Νίκος', text: 'Γεια.' },
      ],
    });
  });

  it('εμφωλευμένοι πίνακες', () => {
    expectRoundTrip({ grid: [['α', 'β'], ['γ', 'δ']] });
  });

  it('κλειδιά με τελείες', () => {
    expectRoundTrip({ 'npc.name': 'Άννα', 'npc.greeting': 'Καλημέρα' });
  });

  it('κλειδιά με backslash', () => {
    expectRoundTrip({ 'path\\to\\thing': 'τιμή' });
  });

  it('ελληνικά και unicode, με emoji', () => {
    expectRoundTrip({ μήνυμα: 'Καλώς ήρθες! 🎮', 'κλειδί.με.τελείες': 'τιμή' });
  });

  it('μικτοί τύποι φύλλων', () => {
    expectRoundTrip({ title: 'Παιχνίδι', version: 2, enabled: true, missing: null });
  });

  it('άδειο αντικείμενο στη ρίζα', () => {
    expectRoundTrip({});
  });

  it('εμφωλευμένα άδεια αντικείμενα και πίνακες', () => {
    expectRoundTrip({ a: {}, b: [], c: { d: {} } });
  });

  it('άδειο κείμενο ως τιμή', () => {
    expectRoundTrip({ blank: '' });
  });

  it('πίνακας στη ρίζα', () => {
    expectRoundTrip(['πρώτο', 'δεύτερο']);
  });

  it('ρεαλιστικό επεισοδιακό αρχείο παιχνιδιού', () => {
    expectRoundTrip({
      meta: { version: 4, episodic: true },
      chapter1: {
        title: 'Η Αρχή',
        scenes: [
          { id: 'intro', lines: ['Ξυπνάς.', 'Το δωμάτιο είναι σκοτεινό.'] },
          { id: 'outro', lines: ['Συνεχίζεται…'] },
        ],
      },
      chapter2: { title: 'Το Ταξίδι', scenes: [] },
    });
  });
});

describe('unflatten με μεταφράσεις', () => {
  it('αντικαθιστά τα μεταφρασμένα κείμενα', () => {
    const source: JsonValue = { menu: { start: 'New Game', quit: 'Quit' } };
    const translations = new Map([
      ['menu.start', 'Νέο παιχνίδι'],
      ['menu.quit', 'Έξοδος'],
    ]);
    expect(unflatten(flatten(source), translations)).toEqual({
      menu: { start: 'Νέο παιχνίδι', quit: 'Έξοδος' },
    });
  });

  it('κρατά το πρωτότυπο όπου λείπει μετάφραση, ώστε το αρχείο να μένει έγκυρο', () => {
    const source: JsonValue = { menu: { start: 'New Game', quit: 'Quit' } };
    const translations = new Map([['menu.start', 'Νέο παιχνίδι']]);
    expect(unflatten(flatten(source), translations)).toEqual({
      menu: { start: 'Νέο παιχνίδι', quit: 'Quit' },
    });
  });

  it('δεν αγγίζει τα μη μεταφράσιμα φύλλα', () => {
    const source: JsonValue = { title: 'Game', version: 7 };
    const out = unflatten(flatten(source), new Map([['title', 'Παιχνίδι']]));
    expect(out).toEqual({ title: 'Παιχνίδι', version: 7 });
  });
});

describe('countStrings', () => {
  it('μετρά μόνο τα μεταφράσιμα φύλλα', () => {
    expect(countStrings({ a: 'x', b: 2, c: { d: 'y', e: true } })).toBe(2);
  });

  it('μηδέν για αρχείο χωρίς κείμενα', () => {
    expect(countStrings({ version: 1, flags: [true, false] })).toBe(0);
  });
});
