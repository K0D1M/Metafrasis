import { useEffect, useState, type FormEvent } from 'react';
import {
  Role,
  TaskStatus,
  type MemberView,
  type SourceFileSummary,
  type TaskView,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, EmptyState, formatDate } from '../components/common.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

export function TasksTab({ project }: { project: ProjectDetail }) {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  // Το «Νέα Εργασία» ανοίγει στην ίδια σελίδα, όχι σε ξεχωριστό παράθυρο.
  const [showForm, setShowForm] = useState(false);

  const isManager = project.role === Role.MANAGER;

  function reload() {
    api
      .get<TaskView[]>(`/projects/${project.id}/tasks`)
      .then(setTasks)
      .catch(() => setTasks([]));
  }

  useEffect(reload, [project.id]);

  if (!tasks) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{el.tasks.title}</h2>
        {isManager && (
          <button className="primary" onClick={() => setShowForm((v) => !v)}>
            {el.tasks.assign}
          </button>
        )}
      </div>

      {showForm && (
        <NewTaskForm
          project={project}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            title={el.tasks.empty}
            hint={isManager ? el.tasks.emptyHintManager : el.tasks.emptyHint}
          />
        </div>
      ) : (
        <div className="stack">
          {tasks.map((task) => (
            <TaskCard key={task.id} project={project} task={task} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  project,
  task,
  onChanged,
}: {
  project: ProjectDetail;
  task: TaskView;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const done = task.status === TaskStatus.DONE;
  const canToggle = task.assignee.id === user?.id || project.role === Role.MANAGER;

  async function toggle() {
    await api.patch(`/projects/${project.id}/tasks/${task.id}`, {
      status: done ? TaskStatus.OPEN : TaskStatus.DONE,
    });
    onChanged();
  }

  async function comment(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      await api.post(`/projects/${project.id}/tasks/${task.id}/comments`, { body });
      setBody('');
      onChanged();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: '0.5rem' }}>
        <div>
          <h3 style={{ margin: 0, textDecoration: done ? 'line-through' : 'none' }}>
            {task.title}
          </h3>
          <span className="muted">
            {el.tasks.assignedTo}: {task.assignee.username} · {el.tasks.assignedBy}:{' '}
            {task.createdBy.username} · {formatDate(task.createdAt)}
          </span>
        </div>
        <div className="row">
          <span className="badge">{done ? el.tasks.done : el.tasks.open}</span>
          {canToggle && (
            <button onClick={() => void toggle()}>
              {done ? el.tasks.reopen : el.tasks.markDone}
            </button>
          )}
        </div>
      </div>

      {task.description && (
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{task.description}</p>
      )}

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {task.files.length === 0 ? (
          <span className="muted">{el.tasks.noFiles}</span>
        ) : (
          task.files.map((file) => (
            <span key={file.id} className="badge">
              {file.name}
            </span>
          ))
        )}
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        {task.comments.length === 0 ? (
          <div className="muted">{el.editor.noComments}</div>
        ) : (
          <div className="stack" style={{ gap: '0.6rem' }}>
            {task.comments.map((c) => (
              <div key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
                <Avatar username={c.author.username} avatarUrl={c.author.avatarUrl} size={26} />
                <div style={{ flex: 1 }}>
                  <div className="row">
                    <strong>{c.author.username}</strong>
                    <span className="muted" style={{ fontSize: '0.85em' }}>
                      {formatDate(c.createdAt)}
                    </span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={comment} style={{ marginTop: '0.75rem' }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={el.editor.addComment}
            style={{ minHeight: 54 }}
          />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.4rem' }}>
            <button type="submit" className="primary" disabled={sending || !body.trim()}>
              {el.editor.send}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Η φόρμα «Νέα Εργασία» — εμφανίζεται στην ίδια σελίδα, όπως ζητήθηκε. */
function NewTaskForm({
  project,
  onClose,
  onCreated,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [files, setFiles] = useState<SourceFileSummary[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<MemberView[]>(`/projects/${project.id}/members`)
      .then((rows) => {
        setMembers(rows);
        setAssigneeId((current) => current || (rows[0]?.userId ?? ''));
      })
      .catch(() => setMembers([]));

    api
      .get<{ files: SourceFileSummary[] }>(`/projects/${project.id}/files`)
      .then((data) => setFiles(data.files))
      .catch(() => setFiles([]));
  }, [project.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${project.id}/tasks`, {
        title,
        description: description || undefined,
        assigneeId,
        fileIds,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: '1rem' }}>
      <h3>{el.tasks.newTask}</h3>

      <div className="field">
        <label htmlFor="task-title">{el.tasks.taskTitle}</label>
        <input
          id="task-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="task-description">{el.tasks.description}</label>
        <textarea
          id="task-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="task-assignee">{el.tasks.assignee}</label>
        <select
          id="task-assignee"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          required
        >
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.username}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{el.tasks.chooseFiles}</label>
        {files.length === 0 ? (
          <span className="muted">{el.sources.empty}</span>
        ) : (
          files.map((file) => (
            <label
              key={file.id}
              className="row"
              style={{ fontWeight: 400, color: 'var(--text)' }}
            >
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={fileIds.includes(file.id)}
                onChange={() =>
                  setFileIds((current) =>
                    current.includes(file.id)
                      ? current.filter((id) => id !== file.id)
                      : [...current, file.id],
                  )
                }
              />
              {file.name}
            </label>
          ))
        )}
      </div>

      {error && <div className="field-error">{error}</div>}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}>
          {el.app.cancel}
        </button>
        <button type="submit" className="primary" disabled={busy || !title.trim() || !assigneeId}>
          {busy ? el.app.loading : el.tasks.assignButton}
        </button>
      </div>
    </form>
  );
}
