import { describe, expect, it } from 'vitest';
import { suggestTargetPath } from '@metafrasis/shared';
import {
  decryptToken,
  encryptToken,
  joinPath,
  parseRepository,
  placeInProject,
  targetDir,
} from './github.js';

describe('parseRepository', () => {
  it('δέχεται owner/repo, URL και .git', () => {
    expect(parseRepository('acme/game-text')).toEqual({ owner: 'acme', repo: 'game-text' });
    expect(parseRepository('https://github.com/acme/game-text')).toEqual({ owner: 'acme', repo: 'game-text' });
    expect(parseRepository('https://github.com/acme/game-text.git/')).toEqual({ owner: 'acme', repo: 'game-text' });
    expect(parseRepository('git@github.com:acme/game.text.git')).toEqual({ owner: 'acme', repo: 'game.text' });
  });

  it('απορρίπτει ό,τι δεν είναι αποθετήριο', () => {
    expect(parseRepository('acme')).toBeNull();
    expect(parseRepository('https://gitlab.com/acme/x')).toBeNull();
    expect(parseRepository('acme/x/tree/main')).toBeNull();
  });
});

describe('διαδρομές', () => {
  it('joinPath αγνοεί κενά τμήματα (ρίζα αποθετηρίου)', () => {
    expect(joinPath('', 'a.json')).toBe('a.json');
    expect(joinPath('locales/el', 'ui/menu.json')).toBe('locales/el/ui/menu.json');
  });

  it('targetDir αντικαθιστά το {lang}', () => {
    expect(targetDir('locales/{lang}', 'el')).toBe('locales/el');
    expect(targetDir('{lang}/text/{lang}', 'de')).toBe('de/text/de');
  });

  it('placeInProject: ο υποφάκελος γίνεται ένα όνομα φακέλου', () => {
    expect(placeInProject('intro.json')).toEqual({ folderName: null, fileName: 'intro.json' });
    expect(placeInProject('ui/menus/main.json')).toEqual({ folderName: 'ui/menus', fileName: 'main.json' });
  });

  it('suggestTargetPath αντικαθιστά τη γλώσσα πηγής', () => {
    expect(suggestTargetPath('locales/en', 'en')).toBe('locales/{lang}');
    expect(suggestTargetPath('assets/en/text', 'en')).toBe('assets/{lang}/text');
    expect(suggestTargetPath('text/source', 'en')).toBe('text/{lang}');
    expect(suggestTargetPath('', 'en')).toBe('{lang}');
  });
});

describe('κρυπτογράφηση token', () => {
  it('κάνει round-trip και δεν αφήνει το token σε καθαρό κείμενο', () => {
    process.env.GITHUB_TOKEN_KEY = 'test-key';
    const token = 'github_pat_11AAAAAAA0123456789';
    const stored = encryptToken(token);
    expect(stored).not.toContain(token);
    expect(decryptToken(stored)).toBe(token);
    // Τυχαίο IV: δύο κρυπτογραφήσεις του ίδιου token διαφέρουν.
    expect(encryptToken(token)).not.toBe(stored);
  });

  it('με άλλο κλειδί αποτυγχάνει με κατανοητό μήνυμα', () => {
    process.env.GITHUB_TOKEN_KEY = 'key-a';
    const stored = encryptToken('secret');
    process.env.GITHUB_TOKEN_KEY = 'key-b';
    expect(() => decryptToken(stored)).toThrow(/δώσε ξανά token/);
  });
});
