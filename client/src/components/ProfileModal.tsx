import { useRef, useState } from 'react';
import {
  RECENT_TRANSLATIONS_MAX,
  RECENT_TRANSLATIONS_MIN,
  type SessionUser,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { resizeToAvatarDataUrl } from '../lib/image.js';
import { Avatar, Modal } from './common.js';
import { Icon } from './Icon.js';

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
          <button
            className="primary icon-btn"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <Icon name="upload" />
            {busy ? el.app.loading : el.profile.changeAvatar}
          </button>
          {user.avatarUrl && (
            <button className="icon-btn" onClick={() => void saveAvatar(null)} disabled={busy}>
              <Icon name="delete" />
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

        <RecentCountSetting />
      </div>
    </Modal>
  );
}

function RecentCountSetting() {
  const { user, setUser } = useAuth();
  const [value, setValue] = useState(String(user?.recentTranslationsCount ?? 10));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  if (!user) return null;
  const parsed = Number(value);
  const valid =
    Number.isInteger(parsed) && parsed >= RECENT_TRANSLATIONS_MIN && parsed <= RECENT_TRANSLATIONS_MAX;
  const changed = parsed !== user.recentTranslationsCount;

  async function save() {
    setStatus('saving');
    try {
      setUser(await api.patch<SessionUser>('/auth/me/preferences', { recentTranslationsCount: parsed }));
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="field" style={{ width: '100%', textAlign: 'start' }}>
      <label htmlFor="recent-count">{el.profile.recentCount}</label>
      <div className="row">
        <input
          id="recent-count"
          type="number"
          min={RECENT_TRANSLATIONS_MIN}
          max={RECENT_TRANSLATIONS_MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 100 }}
        />
        <button
          className="icon-btn"
          onClick={() => void save()}
          disabled={!valid || !changed || status === 'saving'}
        >
          <Icon name="save" />
          {status === 'saving' ? el.app.loading : el.app.save}
        </button>
        {status === 'saved' && <span className="badge">{el.profile.saved}</span>}
      </div>
      <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
        {el.profile.recentCountHint(RECENT_TRANSLATIONS_MIN, RECENT_TRANSLATIONS_MAX)}
      </div>
      {(status === 'error' || (!valid && value !== '')) && (
        <div className="field-error">{el.profile.recentCountInvalid(RECENT_TRANSLATIONS_MIN, RECENT_TRANSLATIONS_MAX)}</div>
      )}
    </div>
  );
}
