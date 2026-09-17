import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LANGUAGES, roleLabels, type ProjectSummary } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { AccountMenu, AdminLink, EmptyState, Modal, ProgressBar, ThemeToggle } from '../components/common.js';
import { NotificationBell } from '../components/NotificationBell.js';

export function ProjectList() {
  const { logout } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get<ProjectSummary[]>('/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div className="spread" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{el.app.name}</h1>
        <div className="row">
          <AdminLink />
          <ThemeToggle />
          <NotificationBell />
          <AccountMenu />
          <button className="ghost" onClick={() => void logout()}>
            {el.auth.logout}
          </button>
        </div>
      </div>

      <div className="spread" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{el.projects.title}</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          {el.projects.create}
        </button>
      </div>

      {projects === null ? (
        <div className="card muted">{el.app.loading}</div>
      ) : projects.length === 0 ? (
        <div className="card">
          <EmptyState title={el.projects.empty} hint={el.projects.emptyHint} />
        </div>
      ) : (
        <div className="stack">
          {projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`} style={{ color: 'inherit' }}>
              <div className="card">
                <div className="spread" style={{ marginBottom: '0.75rem' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{project.name}</h3>
                    <span className="muted">
                      {project.sourceLanguage.toUpperCase()} →{' '}
                      {project.targetLanguages.map((t) => t.toUpperCase()).join(', ')}
                    </span>
                  </div>
                  <span className="badge">{roleLabels[project.role]}</span>
                </div>
                <ProgressBar progress={project.progress} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setProjects((current) => [project, ...(current ?? [])]);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

/** Το παράθυρο «Δημιουργία Project»: όνομα, γλώσσα πηγής, γλώσσες στόχου. */
function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}) {
  const [name, setName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [targetLanguages, setTargetLanguages] = useState<string[]>(['el']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleTarget(code: string) {
    setTargetLanguages((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(
        await api.post<ProjectSummary>('/projects', { name, sourceLanguage, targetLanguages }),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={el.projects.createTitle} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="project-name">{el.projects.name}</label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={el.projects.namePlaceholder}
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="source-language">{el.projects.sourceLanguage}</label>
          <select
            id="source-language"
            value={sourceLanguage}
            onChange={(e) => setSourceLanguage(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{el.projects.targetLanguages}</label>
          {LANGUAGES.filter((lang) => lang.code !== sourceLanguage).map((lang) => (
            <label key={lang.code} className="row" style={{ fontWeight: 400, color: 'var(--text)' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={targetLanguages.includes(lang.code)}
                onChange={() => toggleTarget(lang.code)}
              />
              {lang.label}
            </label>
          ))}
        </div>

        {error && <div className="field-error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" onClick={onClose}>
            {el.app.cancel}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !name.trim() || targetLanguages.length === 0}
          >
            {busy ? el.app.loading : el.projects.createButton}
          </button>
        </div>
      </form>
    </Modal>
  );
}
