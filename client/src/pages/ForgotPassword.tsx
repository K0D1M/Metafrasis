import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { PasswordResetResult } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { ThemeToggle } from '../components/common.js';

/**
 * Ζητά σύνδεσμο επαναφοράς. Χωρίς SMTP σε αυτή τη φάση, ο σύνδεσμος εμφανίζεται εδώ
 * για αντιγραφή — ίδιο μοτίβο με τη Δημιουργία Συνδέσμου στην Προσθήκη μέλους.
 *
 * Ο server ΔΕΝ αποκαλύπτει αν το identifier αντιστοιχεί σε λογαριασμό: η απάντηση
 * φτάνει πάντα εδώ με επιτυχία, με ή χωρίς url. Το UI δείχνει το ίδιο μήνυμα και στις
 * δύο περιπτώσεις, ώστε να μην διαρρεύσει ποιοι λογαριασμοί υπάρχουν.
 */
export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [result, setResult] = useState<PasswordResetResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await api.post<PasswordResetResult>('/auth/password-reset/request', {
        identifier,
      });
      setResult(response);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result?.url) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Χωρίς άδεια clipboard, ο σύνδεσμος είναι ήδη ορατός για χειροκίνητη αντιγραφή.
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <div className="spread" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{el.app.name}</h1>
        <ThemeToggle />
      </div>

      <div className="card">
        <h2>{el.passwordReset.requestTitle}</h2>

        {submitted ? (
          <div className="stack">
            <div>{el.passwordReset.linkReady}</div>
            {result?.url && (
              <>
                <div
                  className="card"
                  style={{ wordBreak: 'break-all', background: 'var(--surface-2)' }}
                >
                  {result.url}
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button onClick={() => void copyLink()}>
                    {copied ? el.members.copied : el.members.copy}
                  </button>
                </div>
                <div className="muted">{el.passwordReset.linkExpiry}</div>
              </>
            )}
            <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
              <Link to="/login">{el.passwordReset.backToLogin}</Link>
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="muted">{el.passwordReset.requestHint}</p>

            <div className="field">
              <label htmlFor="identifier">{el.auth.identifier}</label>
              <input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            {error && <div className="field-error">{error}</div>}

            <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
              {busy ? el.app.loading : el.passwordReset.requestButton}
            </button>

            <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
              <Link to="/login">{el.passwordReset.backToLogin}</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
