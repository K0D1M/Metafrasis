import { useEffect, useState, type FormEvent } from 'react';
import {
  QaSeverity,
  QaStatus,
  qaSeverityLabels,
  Role,
  type QaReportView,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, EmptyState, Modal, formatDate } from '../components/common.js';
import { Icon } from '../components/Icon.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

export function QaTab({ project }: { project: ProjectDetail }) {
  const { user } = useAuth();
  const [reports, setReports] = useState<QaReportView[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<{ url: string; originalName: string } | null>(null);

  function reload() {
    api
      .get<QaReportView[]>(`/projects/${project.id}/qa`)
      .then(setReports)
      .catch(() => setReports([]));
  }

  useEffect(reload, [project.id]);

  async function toggle(report: QaReportView) {
    await api.patch(`/projects/${project.id}/qa/${report.id}`, {
      status: report.status === QaStatus.OPEN ? QaStatus.RESOLVED : QaStatus.OPEN,
    });
    reload();
  }

  async function remove(report: QaReportView) {
    if (!confirm(`${el.app.delete}: ${report.title}?`)) return;
    await api.delete(`/projects/${project.id}/qa/${report.id}`);
    reload();
  }

  if (!reports) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{el.qa.title}</h2>
        <button className="primary icon-btn" onClick={() => setShowForm((v) => !v)}>
          <Icon name="add" />
          {el.qa.create}
        </button>
      </div>

      {showForm && (
        <NewReportForm
          projectId={project.id}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {reports.length === 0 ? (
        <div className="card">
          <EmptyState title={el.qa.empty} hint={el.qa.emptyHint} />
        </div>
      ) : (
        <div className="stack">
          {reports.map((report) => {
            const resolved = report.status === QaStatus.RESOLVED;
            const canDelete = report.author.id === user?.id || project.role === Role.MANAGER;
            return (
              <div key={report.id} className="card">
                <div className="spread" style={{ marginBottom: '0.4rem' }}>
                  <div>
                    <h3 style={{ margin: 0, textDecoration: resolved ? 'line-through' : 'none' }}>
                      {report.title}
                    </h3>
                    {report.string && (
                      <code className="muted" style={{ fontSize: '0.82em' }}>
                        {report.string.fileName} · {report.string.key}
                      </code>
                    )}
                  </div>
                  <div className="row">
                    <span
                      className={`badge${report.severity === QaSeverity.HIGH ? ' warning' : ''}`}
                    >
                      {qaSeverityLabels[report.severity]}
                    </span>
                    <span className="badge">{resolved ? el.qa.resolved : el.qa.open}</span>
                  </div>
                </div>

                <p style={{ whiteSpace: 'pre-wrap' }}>{report.description}</p>

                {report.screenshot && (
                  <button
                    className="ghost"
                    style={{ padding: 0, marginBottom: '0.6rem', cursor: 'zoom-in' }}
                    onClick={() => setPreview(report.screenshot)}
                  >
                    <img
                      src={report.screenshot.url}
                      alt={report.screenshot.originalName}
                      style={{
                        maxWidth: 220,
                        maxHeight: 140,
                        borderRadius: 'var(--radius-sm)',
                        display: 'block',
                      }}
                    />
                  </button>
                )}

                <div className="spread">
                  <div className="row muted" style={{ fontSize: '0.85em' }}>
                    <Avatar
                      username={report.author.username}
                      avatarUrl={report.author.avatarUrl}
                      size={22}
                    />
                    {el.qa.reportedBy}: {report.author.username} · {formatDate(report.createdAt)}
                    {resolved && report.resolvedBy && (
                      <> · {el.qa.resolvedBy}: {report.resolvedBy.username}</>
                    )}
                  </div>
                  <div className="row">
                    <button className="icon-btn" onClick={() => void toggle(report)}>
                      <Icon name={resolved ? 'refresh' : 'save'} />
                      {resolved ? el.qa.reopen : el.qa.resolve}
                    </button>
                    {canDelete && (
                      <button className="ghost danger" onClick={() => void remove(report)}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <Modal title={preview.originalName} onClose={() => setPreview(null)}>
          <img
            src={preview.url}
            alt={preview.originalName}
            style={{ width: '100%', borderRadius: 'var(--radius-sm)' }}
          />
        </Modal>
      )}
    </div>
  );
}

function NewReportForm({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<QaSeverity>(QaSeverity.MEDIUM);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (screenshot) {
        await api.upload(`/projects/${projectId}/qa`, screenshot, { title, description, severity });
      } else {
        await api.post(`/projects/${projectId}/qa`, { title, description, severity });
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: '1rem' }}>
      <h3>{el.qa.create}</h3>

      <div className="field">
        <label htmlFor="qa-title">{el.qa.reportTitle}</label>
        <input
          id="qa-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="qa-description">{el.qa.description}</label>
        <textarea
          id="qa-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="qa-severity">{el.qa.severity}</label>
        <select
          id="qa-severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as QaSeverity)}
        >
          {Object.values(QaSeverity).map((value) => (
            <option key={value} value={value}>
              {qaSeverityLabels[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="qa-screenshot">{el.qa.screenshot}</label>
        <input
          id="qa-screenshot"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && <div className="field-error">{error}</div>}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="icon-btn" onClick={onClose}>
          <Icon name="cancel" />
          {el.app.cancel}
        </button>
        <button
          type="submit"
          className="primary icon-btn"
          disabled={busy || !title.trim() || !description.trim()}
        >
          <Icon name="save" />
          {busy ? el.app.loading : el.app.save}
        </button>
      </div>
    </form>
  );
}
