import { useState } from 'react';
import {
  RECENT_TRANSLATIONS_MAX,
  RECENT_TRANSLATIONS_MIN,
  type SessionUser,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from './Icon.js';
import { DesktopNotificationsSetting } from './DesktopNotificationsSetting.js';

type Preferences = Partial<Pick<SessionUser, 'recentTranslationsCount' | 'hideCompletedStrings'>>;

/**
 * Προσωπικές ρυθμίσεις του χρήστη, στην καρτέλα Ρυθμίσεις κάθε project. Ορατές σε όλα τα
 * μέλη — ισχύουν για τον ίδιο, σε όλα τα projects, όχι για το project.
 */
export function PersonalSettings() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="card">
      <h2>{el.settings.personalTitle}</h2>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        {el.settings.personalHint}
      </p>
      <HideCompletedSetting />
      <RecentCountSetting />
      <DesktopNotificationsSetting />
    </div>
  );
}

function usePreferenceSaver() {
  const { setUser } = useAuth();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save(patch: Preferences) {
    setStatus('saving');
    try {
      setUser(await api.patch<SessionUser>('/auth/me/preferences', patch));
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  }

  return { status, save };
}

function HideCompletedSetting() {
  const { user } = useAuth();
  const { status, save } = usePreferenceSaver();
  if (!user) return null;

  return (
    <div className="field">
      <div className="row">
        <label className="row" style={{ fontWeight: 400, color: 'var(--text)', margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={user.hideCompletedStrings}
            disabled={status === 'saving'}
            onChange={(e) => void save({ hideCompletedStrings: e.target.checked })}
          />
          {el.settings.hideCompleted}
        </label>
        {status === 'saved' && <span className="badge">{el.settings.personalSaved}</span>}
      </div>
      <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
        {el.settings.hideCompletedHint}
      </div>
      {status === 'error' && <div className="field-error">{el.app.error}</div>}
    </div>
  );
}

function RecentCountSetting() {
  const { user } = useAuth();
  const [value, setValue] = useState(String(user?.recentTranslationsCount ?? 10));
  const { status, save } = usePreferenceSaver();

  if (!user) return null;
  const parsed = Number(value);
  const valid =
    Number.isInteger(parsed) && parsed >= RECENT_TRANSLATIONS_MIN && parsed <= RECENT_TRANSLATIONS_MAX;
  const changed = parsed !== user.recentTranslationsCount;

  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor="recent-count">{el.settings.recentCount}</label>
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
          onClick={() => void save({ recentTranslationsCount: parsed })}
          disabled={!valid || !changed || status === 'saving'}
        >
          <Icon name="save" />
          {status === 'saving' ? el.app.loading : el.app.save}
        </button>
        {status === 'saved' && <span className="badge">{el.settings.personalSaved}</span>}
      </div>
      <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.25rem' }}>
        {el.settings.recentCountHint(RECENT_TRANSLATIONS_MIN, RECENT_TRANSLATIONS_MAX)}
      </div>
      {(status === 'error' || (!valid && value !== '')) && (
        <div className="field-error">
          {el.settings.recentCountInvalid(RECENT_TRANSLATIONS_MIN, RECENT_TRANSLATIONS_MAX)}
        </div>
      )}
    </div>
  );
}
