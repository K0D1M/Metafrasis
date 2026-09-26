import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { roleLabels, type Role } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { useAuth } from '../lib/auth.js';
import { api, ApiRequestError } from '../lib/api.js';
import { ThemeToggle } from '../components/common.js';
import { PasswordField } from '../components/PasswordField.js';
import { Icon } from '../components/Icon.js';

interface InvitePreview {
  email: string;
  role: Role;
  projectName: string;
  message: string | null;
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite');

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Το email της πρόσκλησης ανήκει ήδη σε λογαριασμό — η εγγραφή δεν βγάζει νόημα,
  // ο χρήστης πρέπει να συνδεθεί και αυτό θα κάνει την αποδοχή.
  const [existingAccount, setExistingAccount] = useState(false);

  // Ο σύνδεσμος πρόσκλησης προσυμπληρώνει το email και δείχνει σε ποιο project μπαίνει ο χρήστης.
  useEffect(() => {
    if (!inviteToken) return;
    api
      .get<InvitePreview>(`/auth/invite/${inviteToken}`)
      .then((preview) => {
        setInvite(preview);
        setEmail(preview.email);
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : el.app.error));
  }, [inviteToken]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setExistingAccount(false);
    setBusy(true);
    try {
      await register({ email, username, password, ...(inviteToken ? { inviteToken } : {}) });
      navigate('/');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFields(err.fields ?? {});
        // 409 σε εγγραφή με πρόσκληση σημαίνει σχεδόν πάντα ότι το email υπάρχει ήδη —
        // ο σωστός δρόμος είναι σύνδεση, όχι νέα προσπάθεια εγγραφής.
        if (err.status === 409 && inviteToken) setExistingAccount(true);
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

      <form className="card" onSubmit={onSubmit}>
        <h2>{el.auth.registerTitle}</h2>

        {invite && (
          <div className="card" style={{ marginBottom: '1rem', background: 'var(--surface-2)' }}>
            <div>{el.auth.invitedTo(invite.projectName)}</div>
            <div className="muted">
              {el.members.role}: {roleLabels[invite.role]}
            </div>
            {invite.message && <p style={{ marginBottom: 0 }}>«{invite.message}»</p>}
          </div>
        )}

        <div className="field">
          <label htmlFor="email">{el.auth.email}</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            // Το email της πρόσκλησης δεν αλλάζει: η πρόσκληση αφορά συγκεκριμένο παραλήπτη.
            readOnly={!!invite}
            autoComplete="email"
          />
          {fields.email && <div className="field-error">{fields.email}</div>}
        </div>

        <div className="field">
          <label htmlFor="username">{el.auth.username}</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="nickname"
          />
          {fields.username && <div className="field-error">{fields.username}</div>}
        </div>

        <PasswordField
          id="password"
          label={el.auth.password}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={fields.password}
        />

        {error && <div className="field-error">{error}</div>}
        {existingAccount && (
          <div className="field-error">
            {el.auth.existingAccountHint}{' '}
            <Link to={`/login?invite=${inviteToken}`}>{el.auth.login}</Link>
          </div>
        )}

        <button
          type="submit"
          className="primary icon-btn"
          disabled={busy}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <Icon name="add" />
          {busy ? el.app.loading : el.auth.register}
        </button>

        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          {el.auth.hasAccount}{' '}
          <Link to={inviteToken ? `/login?invite=${inviteToken}` : '/login'}>{el.auth.login}</Link>
        </p>
      </form>
    </div>
  );
}
