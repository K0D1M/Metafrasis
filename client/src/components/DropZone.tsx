import { useState, type DragEvent, type ReactNode } from 'react';

/**
 * Περιτύλιγμα drag-and-drop για ανέβασμα αρχείων. Δεν ξέρει τίποτα για JSON, εικόνες,
 * ή endpoints — απλά φιλτράρει τα αρχεία που πέφτουν πάνω του κατά τύπο/κατάληξη και
 * τα περνάει στο onFiles. Η πραγματική λογική ανεβάσματος μένει όπου ήταν ήδη, στο
 * αντίστοιχο tab (handleAdd/handleUpload) — το drop απλά καλεί την ίδια συνάρτηση.
 */
export function DropZone({
  accept,
  onFiles,
  disabled = false,
  children,
}: {
  /** Ίδια μορφή με το attribute accept ενός <input type="file">, π.χ. "image/png,image/jpeg". */
  accept: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);

  const acceptedTypes = accept.split(',').map((s) => s.trim().toLowerCase());

  function matchesAccept(file: File): boolean {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return acceptedTypes.some((rule) =>
      rule.startsWith('.') ? name.endsWith(rule) : rule === type,
    );
  }

  function hasFiles(event: DragEvent): boolean {
    // Ένα drag κειμένου/συνδέσμου δεν έχει "Files" στα types — το αγνοούμε.
    return Array.from(event.dataTransfer.types).includes('Files');
  }

  function onDragOver(event: DragEvent) {
    if (disabled || !hasFiles(event)) return;
    // Χωρίς preventDefault, το drop event δεν πυροδοτείται καθόλου — έτσι δουλεύει η HTML5 Drag API.
    event.preventDefault();
    setActive(true);
  }

  function onDragLeave(event: DragEvent) {
    // currentTarget (το ίδιο το DropZone), όχι target — αλλιώς κάθε παιδί-στοιχείο
    // που περνά το ποντίκι από πάνω κλείνει sfalmena το highlight.
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setActive(false);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setActive(false);
    if (disabled) return;

    const files = Array.from(event.dataTransfer.files).filter(matchesAccept);
    if (files.length > 0) onFiles(files);
  }

  return (
    <div
      data-testid="dropzone"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: 'relative',
        outline: active ? '2px dashed var(--accent)' : 'none',
        outlineOffset: active ? -2 : 0,
        borderRadius: 'var(--radius)',
        transition: 'outline-color 0.12s',
      }}
    >
      {children}
    </div>
  );
}
