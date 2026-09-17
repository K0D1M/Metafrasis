import { createClient, type WebSocketLikeConstructor } from '@supabase/supabase-js';
import WebSocket from 'ws';

/**
 * Client Supabase για τον server, με το secret key — παρακάμπτει το RLS του bucket.
 * Ποτέ δεν εκτίθεται στον browser· μόνο ο server μιλά στο Storage.
 *
 * Ονομασία sb_secret_... (νέο) ή service_role (παλιό, ακόμα λειτουργικό) — δες
 * https://supabase.com/docs/guides/api/api-keys.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Λείπουν οι μεταβλητές περιβάλλοντος SUPABASE_URL ή SUPABASE_SECRET_KEY');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
  // Το createClient αρχικοποιεί πάντα εσωτερικό RealtimeClient (δεν το χρησιμοποιούμε
  // καθόλου εδώ — μόνο Storage), και αυτό χρειάζεται WebSocket global. Σε Node < 22 δεν
  // υπάρχει ενσωματωμένο, οπότε ρίχνει αμέσως στο createClient χωρίς αυτό.
  realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
});

/** Ιδιωτικό bucket: η πρόσβαση περνά πάντα από το requireProjectRole() του API, όχι από δημόσιο URL. */
export const SCREENSHOTS_BUCKET = 'screenshots';

/** Πόσο ισχύει ο υπογεγραμμένος σύνδεσμος μιας εικόνας πριν λήξει. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Δημιουργεί το bucket αν δεν υπάρχει ήδη — καλείται μία φορά στην εκκίνηση του server. */
export async function ensureScreenshotsBucket(): Promise<void> {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  if (buckets.some((b) => b.name === SCREENSHOTS_BUCKET)) return;

  const { error: createError } = await supabase.storage.createBucket(SCREENSHOTS_BUCKET, {
    public: false,
  });
  // Race μεταξύ πολλών instances του server στην εκκίνηση: αγνοούμε "already exists".
  if (createError && !/already exists/i.test(createError.message)) {
    throw createError;
  }
}

export async function uploadScreenshot(objectKey: string, buffer: Buffer, mimeType: string) {
  const { error } = await supabase.storage
    .from(SCREENSHOTS_BUCKET)
    .upload(objectKey, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;
}

export async function deleteScreenshot(objectKey: string): Promise<void> {
  const { error } = await supabase.storage.from(SCREENSHOTS_BUCKET).remove([objectKey]);
  // Το αρχείο μπορεί να λείπει ήδη· η εγγραφή στη βάση έφυγε, που είναι το ουσιώδες.
  if (error) console.error('[metafrasis] αποτυχία διαγραφής από το Storage:', error.message);
}

/**
 * Μαζική διαγραφή — χρησιμοποιείται όταν σβήνεται ολόκληρο project. Το Prisma cascade
 * καθαρίζει τις εγγραφές Screenshot στη βάση, αλλά ΔΕΝ αγγίζει το Storage· χωρίς αυτή
 * τη κλήση τα αρχεία θα έμεναν στο bucket για πάντα, αόρατα και χρεωμένα.
 */
export async function deleteScreenshots(objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  const { error } = await supabase.storage.from(SCREENSHOTS_BUCKET).remove(objectKeys);
  if (error) console.error('[metafrasis] αποτυχία μαζικής διαγραφής από το Storage:', error.message);
}

/** Υπογεγραμμένος, προσωρινός σύνδεσμος — το bucket είναι ιδιωτικό, όχι δημόσιο. */
export async function getScreenshotUrl(objectKey: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SCREENSHOTS_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Ίδιος υπογεγραμμένος σύνδεσμος, αλλά με Content-Disposition: attachment — ο browser
 * κατεβάζει το αρχείο αντί να το ανοίξει inline. Το Storage στέλνει τα ίδια bytes χωρίς
 * καμία επεξεργασία· το download param μόνο αλλάζει το header, όχι το περιεχόμενο.
 */
export async function getScreenshotDownloadUrl(
  objectKey: string,
  downloadName: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SCREENSHOTS_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_TTL_SECONDS, { download: downloadName });
  if (error) throw error;
  return data.signedUrl;
}
