import type { ApiError } from '@metafrasis/shared';

/** Σφάλμα με τα πεδία που απέρριψε ο server, για εμφάνιση δίπλα στα inputs. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.fields = fields;
  }
}

/** Ίδια λογική ανάλυσης απάντησης/σφάλματος, ανεξάρτητα από το αν προήλθε από fetch ή XHR. */
function parsePayload<T>(status: number, text: string): T {
  const payload: unknown = text ? JSON.parse(text) : null;

  if (status < 200 || status >= 300) {
    const error = payload as ApiError | null;
    // Το zod δίνει πίνακα μηνυμάτων ανά πεδίο· κρατάμε το πρώτο για το UI.
    const fields = error?.fields
      ? Object.fromEntries(
          Object.entries(error.fields).map(([key, value]) => [
            key,
            Array.isArray(value) ? String(value[0]) : String(value),
          ]),
        )
      : undefined;
    throw new ApiRequestError(status, error?.error ?? 'Σφάλμα δικτύου', fields);
  }

  return payload as T;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  return parsePayload<T>(res.status, await res.text());
}

export const api = {
  get<T>(path: string): Promise<T> {
    return fetch(`/api${path}`, { credentials: 'include' }).then(handle<T>);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle<T>);
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`/api${path}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle<T>);
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`/api${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle<T>);
  },

  delete<T>(path: string): Promise<T> {
    return fetch(`/api${path}`, { method: 'DELETE', credentials: 'include' }).then(handle<T>);
  },

  /** Ανέβασμα αρχείου. Χωρίς Content-Type: το ορίζει ο browser μαζί με το boundary. */
  upload<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(extra)) form.append(key, value);

    return fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(handle<T>);
  },

  /**
   * Ίδιο με το upload(), αλλά αναφέρει την πρόοδο ανεβάσματος (0-100) μέσω onProgress.
   * Το fetch δεν εκθέτει καθόλου upload progress — μόνο το XMLHttpRequest το κάνει,
   * γι' αυτό αυτή η μέθοδος δεν χτίζεται πάνω στο handle()/fetch των υπολοίπων.
   */
  uploadWithProgress<T>(
    path: string,
    file: File,
    extra: Record<string, string>,
    onProgress: (percent: number) => void,
  ): Promise<T> {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(extra)) form.append(key, value);

    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api${path}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          if (xhr.status === 204) {
            resolve(undefined as T);
            return;
          }
          resolve(parsePayload<T>(xhr.status, xhr.responseText));
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new ApiRequestError(0, 'Σφάλμα δικτύου'));
      xhr.send(form);
    });
  },
};
