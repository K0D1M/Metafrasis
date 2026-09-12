import { useRef, useState } from 'react';
import type { SessionUser } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { resizeToAvatarDataUrl } from '../lib/image.js';
import { Avatar, Modal } from './common.js';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Το avatar το αλλάζει ο ίδιος ο χρήστης· το όνομα χρήστη το αλλάζει μόνο ο
 * διαχειριστής (απαίτηση προδιαγραφής) — γι' αυτό εδώ είναι μόνο για ανάγνωση.
 */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  async function saveAvatar(avatarUrl: string | null) {
    setError(null);
    setBusy(true);
    try {
      const updated = await api.patch<SessionUser>('/auth/me/avatar', { avatarUrl });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(el.profile.invalidType);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await resizeToAvatarDataUrl(file);
      await saveAvatar(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : el.app.error);
      setBusy(false);
    }
  }

  return (
    <Modal title={el.profile.title} onClose={onClose}>
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Avatar username={user.username} avatarUrl={user.avatarUrl} size={96} />

        <div>
          <strong>{user.username}</strong>
          <div className="muted">{user.email}</div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = '';
          }}
        />

        <div className="row">
          <button className="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? el.app.loading : el.profile.changeAvatar}
          </button>
          {user.avatarUrl && (
            <button onClick={() => void saveAvatar(null)} disabled={busy}>
              {el.profile.removeAvatar}
            </button>
          )}
        </div>

        {saved && <span className="badge">{el.profile.saved}</span>}
        {error && <div className="field-error">{error}</div>}

        <div className="field" style={{ width: '100%', marginTop: '0.5rem' }}>
          <label>{el.auth.username}</label>
          <input type="text" value={user.username} readOnly />
          <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
            {el.profile.usernameLocked}
          </div>
        </div>
      </div>
    </Modal>
  );
}
