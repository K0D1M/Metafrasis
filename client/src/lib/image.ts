/**
 * Μετατρέπει μια εικόνα avatar σε μικρό τετράγωνο JPEG data URI.
 *
 * Χωρίς blob storage στο project, το avatar αποθηκεύεται απευθείας στη στήλη
 * User.avatarUrl. Γι' αυτό εδώ σμικραίνουμε αυστηρά πριν την αποθήκευση — ένα ωμό
 * ανέβασμα κινητού θα μπορούσε να είναι πολλά MB.
 */
const TARGET_SIZE = 128;
const JPEG_QUALITY = 0.85;

export function resizeToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Ο browser δεν υποστηρίζει επεξεργασία εικόνας'));
          return;
        }

        // Κεντραρισμένη περικοπή σε τετράγωνο, ώστε το avatar να μην παραμορφώνεται.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);

        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Δεν ήταν δυνατή η ανάγνωση της εικόνας'));
    };

    img.src = objectUrl;
  });
}
