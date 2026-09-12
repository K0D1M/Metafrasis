import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { el } from '../i18n/el.js';
import { useAuth } from '../lib/auth.js';
import { ApiRequestError } from '../lib/api.js';
import { ThemeToggle } from '../components/common.js';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ identifier, password });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
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

      <form className="card" onSubmit={onSubmit}>
        <h2>{el.auth.loginTitle}</h2>

        <div className="field">
          <label htmlFor="identifier">{el.auth.identifier}</label>
          <input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            // Δεν είναι πάντα email (μπορεί να είναι username), οπότε "username" αντί για "email".
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label htmlFor="password">{el.auth.password}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {error && <div className="field-error">{error}</div>}

        <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? el.app.loading : el.auth.login}
        </button>

        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          <Link to="/forgot-password">{el.auth.forgotPassword}</Link>
        </p>
        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          {el.auth.noAccount} <Link to="/register">{el.auth.register}</Link>
        </p>
      </form>
    </div>
  );
}
