import { useEffect, useState, type FormEvent } from 'react';
import {
  Role,
  suggestTargetPath,
  type GithubImportPreview,
  type GithubImportResult,
  type GithubLinkView,
  type GithubPushResult,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { EmptyState, formatDate } from '../components/common.js';
import { Icon } from '../components/Icon.js';
import { PasswordField } from '../components/PasswordField.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

const t = el.integrations;

/** Ίδιο σχήμα με το translationBranch() του server — εδώ μόνο για εμφάνιση. */
const branchFor = (language: string) => `metafrasis/translations-${language}`;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('el-GR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : el.app.error;
}

function GithubMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Διαδρομή μέσα στο αποθετήριο, σε monospace· η ρίζα εμφανίζεται ως "/". */
function RepoPath({ value }: { value: string }) {
  return <code className="repo-path">{value || '/'}</code>;
}

export function IntegrationsTab({
  project,
  onChanged,
}: {
  project: ProjectDetail;
  onChanged: () => void;
}) {
  const [link, setLink] = useState<GithubLinkView | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManager = project.role === Role.MANAGER;

  function load() {
    api
      .get<{ link: GithubLinkView | null }>(`/projects/${project.id}/github`)
      .then((data) => setLink(data.link))
      .catch((err) => {
        setError(errorMessage(err));
        setLink(null);
      });
  }

  useEffect(load, [project.id]);

  async function disconnect() {
    if (!link || !confirm(t.confirmDisconnect(`${link.owner}/${link.repo}`))) return;
    try {
      await api.delete(`/projects/${project.id}/github`);
      setLink(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (link === undefined) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>{t.title}</h2>
      {error && <div className="field-error">{error}</div>}

      {!link && !isManager && (
        <div className="card">
          <EmptyState title={t.notConnected} hint={t.notConnectedHint} />
        </div>
      )}

      {(!link || editing) && isManager && (
        <ConnectForm
          project={project}
          link={link}
          onSaved={(saved) => {
            setLink(saved);
            setEditing(false);
          }}
          onCancel={link ? () => setEditing(false) : undefined}
        />
      )}

      {link && !editing && (
        <>
          <div className="card">
            <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <GithubMark />
                <div>
                  <h3 style={{ margin: 0 }}>
                    <a
                      href={`https://github.com/${link.owner}/${link.repo}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.owner}/{link.repo}
                    </a>
                  </h3>
                  <div className="muted" style={{ fontSize: '0.88em' }}>
                    {t.connectedBy(link.connectedBy.username, formatDate(link.createdAt))}
                  </div>
                </div>
              </div>
              {isManager && (
                <div className="row">
                  <button className="icon-btn" onClick={() => setEditing(true)}>
                    <Icon name="edit" />
                    {t.edit}
                  </button>
                  <button className="danger icon-btn" onClick={() => void disconnect()}>
                    <Icon name="cancel" />
                    {t.disconnect}
                  </button>
                </div>
              )}
            </div>
            <div className="repo-facts">
              <span>
                <span className="muted">{t.branchLabel}</span> <RepoPath value={link.baseBranch} />
              </span>
              <span>
                <span className="muted">{t.sourceLabel}</span> <RepoPath value={link.sourcePath} />
              </span>
              <span>
                <span className="muted">{t.targetLabel}</span> <RepoPath value={link.targetPath} />
              </span>
            </div>
          </div>

          {isManager ? (
            <div className="sync-grid">
              <ImportCard project={project} link={link} onImported={() => { load(); onChanged(); }} />
              <PushCard project={project} link={link} onPushed={load} />
            </div>
          ) : (
            <div className="card">
              <div className="muted">{t.managerOnly}</div>
              {link.lastPullUrl && (
                <div style={{ marginTop: '0.5rem' }}>
                  {t.lastPull}:{' '}
                  <a href={link.lastPullUrl} target="_blank" rel="noreferrer">
                    {link.lastPullUrl.replace('https://github.com/', '')}
                  </a>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Φόρμα σύνδεσης ───────────────────────────────────────────────────────── */

function ConnectForm({
  project,
  link,
  onSaved,
  onCancel,
}: {
  project: ProjectDetail;
  link: GithubLinkView | null;
  onSaved: (link: GithubLinkView) => void;
  onCancel?: () => void;
}) {
  const [repository, setRepository] = useState(link ? `${link.owner}/${link.repo}` : '');
  const [baseBranch, setBaseBranch] = useState(link?.baseBranch ?? 'main');
  const [sourcePath, setSourcePath] = useState(link?.sourcePath ?? '');
  const [targetPath, setTargetPath] = useState(link?.targetPath ?? '');
  // Ο φάκελος μεταφράσεων ακολουθεί τον φάκελο πηγής μέχρι να τον αλλάξει ο χρήστης.
  const [targetTouched, setTargetTouched] = useState(Boolean(link));
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const sourcePlaceholder = `locales/${project.sourceLanguage}`;
  const effectiveTarget = targetTouched
    ? targetPath
    : suggestTargetPath(sourcePath || sourcePlaceholder, project.sourceLanguage);
  const exampleLanguage = project.targetLanguages[0] ?? 'el';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = await api.put<{ link: GithubLinkView }>(`/projects/${project.id}/github`, {
        repository,
        baseBranch,
        sourcePath,
        targetPath: effectiveTarget,
        ...(token ? { token } : {}),
      });
      onSaved(result.link);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError && err.fields) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-start' }}>
        <GithubMark />
        <div>
          <h3 style={{ margin: 0 }}>{link ? t.editTitle : t.connectTitle}</h3>
          <span className="muted">{t.githubDescription}</span>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="gh-repo">{t.repository}</label>
          <input
            id="gh-repo"
            type="text"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="studio/game-localization"
            required
            autoFocus={!link}
          />
          {fields.repository ? (
            <div className="field-error">{fields.repository}</div>
          ) : (
            <div className="muted field-hint">{t.repositoryHint}</div>
          )}
        </div>

        <div className="field">
          <label htmlFor="gh-branch">{t.baseBranch}</label>
          <input id="gh-branch" type="text" value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} required />
          {fields.baseBranch ? (
            <div className="field-error">{fields.baseBranch}</div>
          ) : (
            <div className="muted field-hint">{t.baseBranchHint}</div>
          )}
        </div>

        <div className="field">
          <label htmlFor="gh-source">{t.sourcePath}</label>
          <input
            id="gh-source"
            type="text"
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder={sourcePlaceholder}
          />
          {fields.sourcePath ? (
            <div className="field-error">{fields.sourcePath}</div>
          ) : (
            <div className="muted field-hint">{t.sourcePathHint}</div>
          )}
        </div>

        <div className="field">
          <label htmlFor="gh-target">{t.targetPath}</label>
          <input
            id="gh-target"
            type="text"
            value={effectiveTarget}
            onChange={(e) => {
              setTargetTouched(true);
              setTargetPath(e.target.value);
            }}
            required
          />
          {fields.targetPath ? (
            <div className="field-error">{fields.targetPath}</div>
          ) : (
            <div className="muted field-hint">
              {t.targetPathHint} <RepoPath value={effectiveTarget.replaceAll('{lang}', exampleLanguage)} />
            </div>
          )}
        </div>
      </div>

      <PasswordField
        id="gh-token"
        label={t.token}
        value={token}
        onChange={setToken}
        autoComplete="off"
        required={!link}
        error={fields.token}
      />
      <div className="token-help">
        {link && <div>{t.tokenKeep(link.tokenHint)}</div>}
        <div>
          {t.tokenHelp} <strong>{t.tokenPermissions}</strong>.{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
          >
            {t.tokenCreate} ↗
          </a>
        </div>
        <div>{t.tokenStored}</div>
      </div>

      {error && !Object.keys(fields).length && <div className="field-error">{error}</div>}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            {el.app.cancel}
          </button>
        )}
        <button type="submit" className="primary icon-btn" disabled={busy}>
          <Icon name="save" />
          {busy ? t.connecting : link ? el.app.save : t.connect}
        </button>
      </div>
    </form>
  );
}

/* ── Εισαγωγή ─────────────────────────────────────────────────────────────── */

function ImportCard({
  project,
  link,
  onImported,
}: {
  project: ProjectDetail;
  link: GithubLinkView;
  onImported: () => void;
}) {
  const [preview, setPreview] = useState<GithubImportPreview | null>(null);
  const [result, setResult] = useState<GithubImportResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = preview?.files.filter((f) => f.status === 'new' || f.status === 'changed').length ?? 0;

  async function check() {
    setBusy('check');
    setError(null);
    setResult(null);
    try {
      setPreview(await api.get<GithubImportPreview>(`/projects/${project.id}/github/import/preview`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy('import');
    setError(null);
    try {
      setResult(await api.post<GithubImportResult>(`/projects/${project.id}/github/import`));
      setPreview(null);
      onImported();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card sync-card">
      <div>
        <h3 className="row" style={{ margin: 0 }}>
          <Icon name="download" />
          {t.importTitle}
        </h3>
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>{t.importHint}</p>
      </div>

      <div className="muted sync-meta">
        {link.lastImportAt && link.lastImportSha
          ? t.lastImport(formatDateTime(link.lastImportAt), link.lastImportSha.slice(0, 7))
          : t.neverImported}
      </div>

      {preview && (
        <div className="sync-list">
          <table>
            <tbody>
              {preview.files.map((file) => (
                <tr key={file.path} title={file.error}>
                  <td>
                    <RepoPath value={file.path} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      className={`badge ${
                        file.status === 'new'
                          ? 'success'
                          : file.status === 'changed'
                            ? 'warning'
                            : file.status === 'invalid'
                              ? 'danger'
                              : ''
                      }`}
                    >
                      {t.status[file.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && pending === 0 && <div className="muted">{t.upToDate}</div>}

      {result && (
        <div className="sync-result">
          <span className="badge success">{t.importDone(result.created, result.updated, result.unchanged)}</span>
          {result.failed.length > 0 && (
            <div className="field-error">
              {t.importFailed(result.failed.length)}:{' '}
              {result.failed.map((f) => `${f.path} (${f.error})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {error && <div className="field-error">{error}</div>}

      <div className="row sync-actions">
        <button className="icon-btn" onClick={() => void check()} disabled={busy !== null}>
          <Icon name="refresh" />
          {busy === 'check' ? t.checking : t.check}
        </button>
        {preview && pending > 0 && (
          <button className="primary icon-btn" onClick={() => void runImport()} disabled={busy !== null}>
            <Icon name="download" />
            {busy === 'import' ? t.importing : t.importRun(pending)}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Αποστολή ─────────────────────────────────────────────────────────────── */

function PushCard({
  project,
  link,
  onPushed,
}: {
  project: ProjectDetail;
  link: GithubLinkView;
  onPushed: () => void;
}) {
  const [language, setLanguage] = useState(project.targetLanguages[0] ?? 'el');
  const [result, setResult] = useState<GithubPushResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function push() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<GithubPushResult>(`/projects/${project.id}/github/push`, { language }));
      onPushed();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card sync-card">
      <div>
        <h3 className="row" style={{ margin: 0 }}>
          <Icon name="upload" />
          {t.pushTitle}
        </h3>
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>{t.pushHint}</p>
      </div>

      <div className="muted sync-meta">
        {link.lastPushAt ? t.lastPush(formatDateTime(link.lastPushAt)) : t.neverPushed}
        {link.lastPullUrl && (
          <>
            {' · '}
            <a href={link.lastPullUrl} target="_blank" rel="noreferrer">
              {t.lastPull}
            </a>
          </>
        )}
      </div>

      <dl className="push-facts">
        {project.targetLanguages.length > 1 && (
          <>
            <dt>{t.language}</dt>
            <dd>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {project.targetLanguages.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </dd>
          </>
        )}
        <dt>{t.destination}</dt>
        <dd>
          <RepoPath value={link.targetPath.replaceAll('{lang}', language)} />
        </dd>
        <dt>{t.branchLabel}</dt>
        <dd>
          <RepoPath value={branchFor(language)} /> → <RepoPath value={link.baseBranch} />
        </dd>
      </dl>

      {result && (
        <div className="sync-result">
          <span className={`badge ${result.committed ? 'success' : ''}`}>
            {result.committed
              ? t.pushDone(result.fileCount)
              : result.pullUrl
                ? t.pushNoChanges
                : t.pushNothing}
          </span>
          {result.pullUrl && result.pullNumber !== null && (
            <a href={result.pullUrl} target="_blank" rel="noreferrer">
              {t.openPull(result.pullNumber)} ↗
            </a>
          )}
        </div>
      )}

      {error && <div className="field-error">{error}</div>}

      <div className="row sync-actions">
        <button className="primary icon-btn" onClick={() => void push()} disabled={busy}>
          <Icon name="upload" />
          {busy ? t.pushing : t.push}
        </button>
      </div>
    </div>
  );
}
