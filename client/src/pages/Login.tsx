import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { el } from '../i18n/el.js';
import { useAuth } from '../lib/auth.js';
import { api, ApiRequestError } from '../lib/api.js';
import { ThemeToggle } from '../components/common.js';
import { PasswordField } from '../components/PasswordField.js';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Παρόν όταν κάποιος με ήδη λογαριασμό πατά σύνδεσμο πρόσκλησης: η εγγραφή θα
  // αποτύχει (το email υπάρχει ήδη), οπότε η σύνδεση εδώ κάνει και την αποδοχή.
  const inviteToken = params.get('invite');

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

      if (inviteToken) {
        try {
          await api.post(`/auth/invite/${inviteToken}/accept`);
        } catch (err) {
          // Η σύνδεση πέτυχε ούτως ή άλλως — δεν μπλοκάρουμε τον χρήστη έξω από την
          // εφαρμογή επειδή η πρόσκληση ήταν άκυρη ή έληξε. Απλά το αναφέρουμε.
          setError(err instanceof ApiRequestError ? err.message : el.app.error);
        }
      }

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

        {inviteToken && <div className="card" style={{ marginBottom: '1rem', background: 'var(--surface-2)' }}>
          {el.auth.inviteLoginHint}
        </div>}

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

        <PasswordField
          id="password"
          label={el.auth.password}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        {error && <div className="field-error">{error}</div>}

        <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? el.app.loading : el.auth.login}
        </button>

        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          <Link to="/forgot-password">{el.auth.forgotPassword}</Link>
        </p>
        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          {el.auth.noAccount}{' '}
          <Link to={inviteToken ? `/register?invite=${inviteToken}` : '/register'}>
            {el.auth.register}
          </Link>
        </p>
      </form>

      <p className="muted" style={{ fontSize: '0.75em', textAlign: 'center', marginTop: '2rem' }}>
        {el.app.iconCredit}
      </p>
    </div>
  );
}
