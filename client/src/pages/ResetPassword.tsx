import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { SessionUser } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { useAuth } from '../lib/auth.js';
import { api, ApiRequestError } from '../lib/api.js';
import { ThemeToggle } from '../components/common.js';

export function ResetPassword() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setFields({});
    setBusy(true);
    try {
      const user = await api.post<SessionUser>('/auth/password-reset/confirm', {
        token,
        password,
      });
      setUser(user);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFields(err.fields ?? {});
      } else {
        setError(el.app.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <div className="spread" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{el.app.name}</h1>
        <ThemeToggle />
      </div>

      <div className="card">
        <h2>{el.passwordReset.confirmTitle}</h2>

        {!token ? (
          <div className="stack">
            <div className="field-error">{el.passwordReset.missingToken}</div>
            <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
              <Link to="/forgot-password">{el.auth.forgotPassword}</Link>
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="new-password">{el.passwordReset.newPassword}</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
              />
              {fields.password && <div className="field-error">{fields.password}</div>}
            </div>

            {error && <div className="field-error">{error}</div>}

            <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
              {busy ? el.app.loading : el.passwordReset.confirmButton}
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
