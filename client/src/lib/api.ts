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

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
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
    throw new ApiRequestError(res.status, error?.error ?? 'Σφάλμα δικτύου', fields);
  }

  return payload as T;
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
};
