import { describe, it, expect } from 'vitest';
import { planIngest, parseJsonUpload, type ExistingString } from './ingest.js';

const existing: ExistingString[] = [
  { key: 'menu.start', sourceText: 'New Game' },
  { key: 'menu.quit', sourceText: 'Quit' },
];

describe('planIngest', () => {
  it('εντοπίζει νέα κλειδιά', () => {
    const plan = planIngest({ menu: { start: 'New Game', quit: 'Quit', load: 'Load' } }, existing);
    expect(plan.added).toEqual([{ key: 'menu.load', sourceText: 'Load', order: 2 }]);
    expect(plan.changed).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it('αφήνει ήσυχα τα αμετάβλητα κλειδιά', () => {
    const plan = planIngest({ menu: { start: 'New Game', quit: 'Quit' } }, existing);
    expect(plan.unchanged.map((u) => u.key)).toEqual(['menu.start', 'menu.quit']);
    expect(plan.added).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it('σημαιοδοτεί για έλεγχο όσα κλειδιά άλλαξαν πρωτότυπο', () => {
    const plan = planIngest({ menu: { start: 'Start Game', quit: 'Quit' } }, existing);
    expect(plan.changed).toEqual([{ key: 'menu.start', sourceText: 'Start Game', order: 0 }]);
    // Κρίσιμο: το κλειδί δεν θεωρείται νέο, άρα η μετάφρασή του επιβιώνει.
    expect(plan.added).toEqual([]);
  });

  it('σημαιοδοτεί ως removed όσα λείπουν, χωρίς να τα διαγράφει', () => {
    const plan = planIngest({ menu: { start: 'New Game' } }, existing);
    expect(plan.removed).toEqual(['menu.quit']);
    expect(plan.added).toEqual([]);
  });

  it('επαναφέρει κλειδί που είχε λείψει και ξαναεμφανίστηκε', () => {
    const plan = planIngest(
      { menu: { start: 'New Game', quit: 'Quit' } },
      existing,
      new Set(['menu.quit']),
    );
    expect(plan.restored).toEqual(['menu.quit']);
    // Δεν ξαναμπαίνει στη λίστα removed, ούτε θεωρείται νέο.
    expect(plan.removed).toEqual([]);
    expect(plan.added).toEqual([]);
  });

  it('ενημερώνει τη σειρά όταν αναδιατάσσεται το αρχείο', () => {
    const plan = planIngest({ menu: { quit: 'Quit', start: 'New Game' } }, existing);
    expect(plan.unchanged).toEqual([
      { key: 'menu.quit', order: 0 },
      { key: 'menu.start', order: 1 },
    ]);
  });

  it('καμία ενέργεια δεν αφορά διαγραφή μετάφρασης', () => {
    const plan = planIngest({ menu: { start: 'Changed', load: 'Load' } }, existing);
    // Τα τρία σύνολα καλύπτουν κάθε υπάρχον κλειδί χωρίς απώλεια.
    const touched = [
      ...plan.changed.map((c) => c.key),
      ...plan.unchanged.map((u) => u.key),
      ...plan.removed,
    ];
    expect(new Set(touched)).toEqual(new Set(existing.map((e) => e.key)));
  });

  it('πρώτο ανέβασμα: όλα είναι νέα', () => {
    const plan = planIngest({ a: 'x', b: 'y' }, []);
    expect(plan.added.map((a) => a.key)).toEqual(['a', 'b']);
    expect(plan.removed).toEqual([]);
  });
});

describe('parseJsonUpload', () => {
  it('διαβάζει κανονικό JSON', () => {
    expect(parseJsonUpload(Buffer.from('{"a":"b"}', 'utf8'))).toEqual({ a: 'b' });
  });

  it('αγνοεί το BOM που βάζουν εργαλεία των Windows', () => {
    expect(parseJsonUpload(Buffer.from('﻿{"a":"b"}', 'utf8'))).toEqual({ a: 'b' });
  });

  it('διατηρεί ελληνικούς χαρακτήρες', () => {
    expect(parseJsonUpload(Buffer.from('{"μ":"Καλημέρα"}', 'utf8'))).toEqual({ μ: 'Καλημέρα' });
  });

  it('εξηγεί τι πήγε στραβά σε άκυρο JSON', () => {
    expect(() => parseJsonUpload(Buffer.from('{oops', 'utf8'))).toThrow(/δεν είναι έγκυρο JSON/);
  });

  it('απορρίπτει JSON που δεν είναι αντικείμενο ή πίνακας', () => {
    expect(() => parseJsonUpload(Buffer.from('"σκέτο κείμενο"', 'utf8'))).toThrow(
      /αντικείμενο ή πίνακα/,
    );
  });
});
