import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { roleLabels, type Role } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { useAuth } from '../lib/auth.js';
import { api, ApiRequestError } from '../lib/api.js';
import { ThemeToggle } from '../components/common.js';

interface InvitePreview {
  email: string;
  role: Role;
  projectName: string;
  message: string | null;
}

/**
 * Όταν κάποιος ήδη συνδεδεμένος πατά σύνδεσμο πρόσκλησης. Χωρίς αυτή τη σελίδα, το
 * RedirectIfAuthed θα τον πήγαινε κατευθείαν στην αρχική, χάνοντας την πρόσκληση.
 */
export function AcceptInvite() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('invite');

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    if (!token) return;
    api
      .get<InvitePreview>(`/auth/invite/${token}`)
      .then(setInvite)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : el.app.error))
      .finally(() => setLoadingPreview(false));
  }, [token]);

  async function accept() {
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/auth/invite/${token}/accept`);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  if (!token || !user) return null;

  const emailMismatch = invite && invite.email.toLowerCase() !== user.email.toLowerCase();

  return (
    <div style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <div className="spread" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{el.app.name}</h1>
        <ThemeToggle />
      </div>

      <div className="card">
        <h2>{el.auth.acceptInviteTitle}</h2>

        {loadingPreview ? (
          <div className="muted">{el.app.loading}</div>
        ) : invite ? (
          <>
            <div className="card" style={{ marginBottom: '1rem', background: 'var(--surface-2)' }}>
              <div>{el.auth.invitedTo(invite.projectName)}</div>
              <div className="muted">
                {el.members.role}: {roleLabels[invite.role]}
              </div>
              {invite.message && <p style={{ marginBottom: 0 }}>«{invite.message}»</p>}
            </div>

            {emailMismatch ? (
              <div className="stack">
                <div className="field-error">
                  {el.auth.inviteEmailMismatch(invite.email, user.username)}
                </div>
                <button onClick={() => void logout().then(() => navigate(`/login?invite=${token}`))}>
                  {el.auth.logoutAndSwitch}
                </button>
              </div>
            ) : (
              <>
                <p className="muted">{el.auth.acceptInviteAs(user.username)}</p>
                {error && <div className="field-error">{error}</div>}
                <button
                  className="primary"
                  onClick={() => void accept()}
                  disabled={busy}
                  style={{ width: '100%' }}
                >
                  {busy ? el.app.loading : el.auth.acceptInviteButton}
                </button>
              </>
            )}
          </>
        ) : (
          <div className="field-error">{error}</div>
        )}

        <p className="muted" style={{ marginBottom: 0, textAlign: 'center', marginTop: '1rem' }}>
          <Link to="/">{el.app.name}</Link>
        </p>
      </div>
    </div>
  );
}
