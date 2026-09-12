/**
 * Οι τιμές των HTTP headers είναι Latin-1. Ένα ελληνικό όνομα αρχείου ρίχνει το
 * res.setHeader με ERR_INVALID_CHAR — και ένα ανεπιτήρητο throw εκεί ρίχνει όλο τον
 * διακομιστή. Γι' αυτό κάθε Content-Disposition περνά από εδώ.
 */
export function attachmentHeader(filename: string): string {
  // Η κατάληξη κρατιέται χωριστά: χωρίς αυτήν, ένα καθαρά ελληνικό όνομα θα κατέβαινε
  // ως αρχείο χωρίς τύπο και τα Windows δεν θα ήξεραν με τι να το ανοίξουν.
  const lastDot = filename.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < filename.length - 1;
  const rawStem = hasExtension ? filename.slice(0, lastDot) : filename;
  const rawExtension = hasExtension ? filename.slice(lastDot + 1) : '';

  const toAscii = (value: string): string =>
    value
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/["\\]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '');

  // Ένα ελληνικό όνομα αδειάζει τελείως· χρειάζεται κάτι που να μένει χρησιμοποιήσιμο.
  const stem = toAscii(rawStem) || 'download';
  const extension = toAscii(rawExtension);
  const ascii = extension ? `${stem}.${extension}` : stem;

  // RFC 5987: το πραγματικό όνομα, που προτιμούν οι σύγχρονοι browsers.
  const encoded = encodeURIComponent(filename);

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
