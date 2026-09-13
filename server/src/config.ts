/**
 * Ρυθμίσεις που πρέπει να είναι σωστές πριν βγει live ο server — ό,τι λείπει εδώ
 * γίνεται λάθος σε παραγωγικό περιβάλλον αντί για σιωπηλή υποχώρηση σε localhost.
 *
 * Ακριβώς αυτό το bug συνέβη με τους συνδέσμους πρόσκλησης και επαναφοράς κωδικού:
 * χωρίς CLIENT_ORIGIN στο Railway, ο server έφτιαχνε συνδέσμους προς localhost:5173,
 * που δεν σημαίνει τίποτα για κάποιον που τους ανοίγει σε άλλη συσκευή.
 */
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const rawOrigin = process.env.CLIENT_ORIGIN;

if (IS_PRODUCTION && !rawOrigin) {
  throw new Error(
    'Λείπει η μεταβλητή περιβάλλοντος CLIENT_ORIGIN σε production — οι σύνδεσμοι ' +
      'πρόσκλησης και επαναφοράς κωδικού θα έδειχναν σε localhost. Ρύθμισέ την στο ' +
      'πραγματικό domain (π.χ. https://metafrasis.up.railway.app), χωρίς κατάληξη "/".',
  );
}

/** Το domain του live app· μόνο σε dev επιτρέπεται η υποχώρηση σε localhost. */
export const CLIENT_ORIGIN = rawOrigin ?? 'http://localhost:5173';
