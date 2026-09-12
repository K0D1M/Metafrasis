import { describe, it, expect } from 'vitest';
import { attachmentHeader } from './contentDisposition.js';

/** Οι τιμές των headers πρέπει να είναι γραψίμες ως Latin-1, αλλιώς ρίχνουν τον server. */
function isLatin1Safe(value: string): boolean {
  return [...value].every((char) => char.charCodeAt(0) <= 0xff);
}

describe('attachmentHeader', () => {
  it('κρατά ένα απλό αγγλικό όνομα', () => {
    expect(attachmentHeader('chapter1.json')).toContain('filename="chapter1.json"');
  });

  it('ΔΕΝ ρίχνει σε ελληνικό όνομα — το σφάλμα που είχε ρίξει τον διακομιστή', () => {
    const header = attachmentHeader('Το Επεισοδιακό Παιχνίδι_el.zip');
    expect(isLatin1Safe(header)).toBe(true);
  });

  it('διατηρεί το πραγματικό όνομα μέσω filename*', () => {
    const header = attachmentHeader('Κεφάλαιο.json');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent('Κεφάλαιο.json'));
  });

  it('δίνει χρησιμοποιήσιμο ASCII fallback που ΔΙΑΤΗΡΕΙ την κατάληξη', () => {
    // Χωρίς την κατάληξη, το αρχείο θα κατέβαινε χωρίς τύπο.
    expect(attachmentHeader('Παιχνίδι.zip')).toContain('filename="download.zip"');
  });

  it('διατηρεί την κατάληξη και σε ελληνικό όνομα .json', () => {
    expect(attachmentHeader('Κεφάλαιο.json')).toContain('filename="download.json"');
  });

  it('χρησιμοποιεί προεπιλογή όταν δεν μένει τίποτα', () => {
    expect(attachmentHeader('Παιχνίδι')).toContain('filename="download"');
  });

  it('διατηρεί το λατινικό τμήμα όταν το όνομα είναι μικτό', () => {
    // Οι ελληνικοί χαρακτήρες φεύγουν και η κατάληξη υπογράμμισης κόβεται.
    expect(attachmentHeader('chapter1_Κεφάλαιο.json')).toContain('filename="chapter1.json"');
  });

  it('αφαιρεί εισαγωγικά που θα έσπαγαν το header', () => {
    const header = attachmentHeader('we"ird\\name.json');
    expect(header).toContain('filename="weirdname.json"');
  });

  it('κάθε είσοδος παράγει header γραψίμο ως Latin-1', () => {
    for (const name of [
      'plain.json',
      'Ελληνικά.json',
      '日本語.json',
      'emoji🎮.zip',
      '',
      '   ',
      '../../etc/passwd',
    ]) {
      expect(isLatin1Safe(attachmentHeader(name))).toBe(true);
    }
  });
});
