import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Role } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { EmptyState } from '../components/common.js';
import { Icon } from '../components/Icon.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

export function SettingsTab({
  project,
  onChanged,
}: {
  project: ProjectDetail;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [activityVisibleToAll, setActivityVisibleToAll] = useState(project.activityVisibleToAll);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (project.role !== Role.MANAGER) {
    return (
      <div className="card">
        <EmptyState title={el.settings.managerOnly} />
      </div>
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await api.patch(`/projects/${project.id}/settings`, { name, activityVisibleToAll });
      setSaved(true);
      onChanged();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(el.settings.confirmDelete(project.name))) return;
    try {
      await api.delete(`/projects/${project.id}`);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={save}>
        <h2>{el.settings.title}</h2>

        <div className="field">
          <label htmlFor="settings-name">{el.settings.projectName}</label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="row" style={{ fontWeight: 400, color: 'var(--text)' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={activityVisibleToAll}
              onChange={(e) => setActivityVisibleToAll(e.target.checked)}
            />
            {el.settings.activityVisibility}
          </label>
          <div className="muted">{el.settings.activityVisibilityHint}</div>
        </div>

        {error && <div className="field-error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {saved && <span className="badge">{el.settings.saved}</span>}
          <button type="submit" className="primary icon-btn" disabled={busy || !name.trim()}>
            <Icon name="save" />
            {busy ? el.app.loading : el.app.save}
          </button>
        </div>
      </form>

      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <h3 style={{ color: 'var(--danger)' }}>{el.settings.dangerZone}</h3>
        <p className="muted">{el.settings.deleteHint}</p>
        <button className="danger icon-btn" onClick={() => void remove()}>
          <Icon name="delete" />
          {el.settings.deleteProject}
        </button>
      </div>
    </div>
  );
}
