import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Role, roleLabels, type AdminProjectView, type AdminUserView } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { Avatar, EmptyState, ProgressBar, ThemeToggle, formatDate } from '../components/common.js';
import { Icon } from '../components/Icon.js';

export function AdminDashboard() {
  const [tab, setTab] = useState<'projects' | 'users'>('projects');

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div className="spread" style={{ marginBottom: '1.5rem' }}>
        <div>
          <Link to="/" className="muted">
            ← {el.app.name}
          </Link>
          <h1 style={{ margin: '0.2rem 0 0' }}>{el.admin.title}</h1>
        </div>
        <ThemeToggle />
      </div>

      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        <button className={`tab${tab === 'projects' ? ' active' : ''}`} onClick={() => setTab('projects')}>
          {el.admin.projectsTab}
        </button>
        <button className={`tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
          {el.admin.usersTab}
        </button>
      </div>

      {tab === 'projects' ? <AdminProjects /> : <AdminUsers />}
    </div>
  );
}

function AdminProjects() {
  const [projects, setProjects] = useState<AdminProjectView[] | null>(null);
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.get<AdminProjectView[]>('/admin/projects').then(setProjects).catch(() => setProjects([]));
  }

  useEffect(reload, []);
  useEffect(() => {
    api.get<AdminUserView[]>('/admin/users').then(setUsers).catch(() => setUsers([]));
  }, []);

  if (!projects) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div className="stack">
      {error && <div className="field-error">{error}</div>}
      {projects.length === 0 ? (
        <div className="card">
          <EmptyState title={el.admin.noProjects} />
        </div>
      ) : (
        projects.map((project) => (
          <AdminProjectCard
            key={project.id}
            project={project}
            allUsers={users ?? []}
            onChanged={reload}
            onError={setError}
          />
        ))
      )}
    </div>
  );
}

function AdminProjectCard({
  project,
  allUsers,
  onChanged,
  onError,
}: {
  project: AdminProjectView;
  allUsers: AdminUserView[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingUserId, setAddingUserId] = useState('');
  const [addingRole, setAddingRole] = useState<Role>(Role.TRANSLATOR);

  const memberIds = new Set(project.members.map((m) => m.userId));
  const addable = allUsers.filter((u) => !memberIds.has(u.id));

  async function changeRole(userId: string, role: Role) {
    try {
      await api.patch(`/admin/projects/${project.id}/members/${userId}`, { role });
      onChanged();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  async function removeMember(userId: string, username: string) {
    if (!confirm(`${el.admin.remove}: ${username}?`)) return;
    try {
      await api.delete(`/admin/projects/${project.id}/members/${userId}`);
      onChanged();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  async function addMember() {
    if (!addingUserId) return;
    try {
      await api.post(`/admin/projects/${project.id}/members`, {
        userId: addingUserId,
        role: addingRole,
      });
      setAddingUserId('');
      onChanged();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: '0.6rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>{project.name}</h3>
          <span className="muted">
            {project.sourceLanguage.toUpperCase()} →{' '}
            {project.targetLanguages.map((t) => t.toUpperCase()).join(', ')}
          </span>
        </div>
        <button className="ghost" onClick={() => setExpanded((v) => !v)}>
          {el.admin.members} ({project.members.length})
        </button>
      </div>

      <ProgressBar progress={project.progress} showLabel={false} />

      {expanded && (
        <div style={{ marginTop: '1rem' }}>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{el.auth.username}</th>
                  <th className="hide-narrow">{el.members.email}</th>
                  <th>{el.admin.role}</th>
                  <th className="hide-narrow">{el.members.memberSince}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {project.members.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <div className="row">
                        <Avatar username={member.username} avatarUrl={member.avatarUrl} size={26} />
                        {member.username}
                      </div>
                    </td>
                    <td className="hide-narrow muted">{member.email}</td>
                    <td>
                      <select
                        value={member.role}
                        onChange={(e) => void changeRole(member.userId, e.target.value as Role)}
                      >
                        <option value={Role.MANAGER}>{roleLabels[Role.MANAGER]}</option>
                        <option value={Role.TRANSLATOR}>{roleLabels[Role.TRANSLATOR]}</option>
                      </select>
                    </td>
                    <td className="hide-narrow muted">{formatDate(member.joinedAt)}</td>
                    <td style={{ textAlign: 'end' }}>
                      <button
                        className="ghost danger icon-btn"
                        onClick={() => void removeMember(member.userId, member.username)}
                      >
                        <Icon name="delete" />
                        {el.admin.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: '0.75rem' }}>
            <select value={addingUserId} onChange={(e) => setAddingUserId(e.target.value)}>
              <option value="">{el.admin.selectUser}</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
            <select value={addingRole} onChange={(e) => setAddingRole(e.target.value as Role)}>
              <option value={Role.TRANSLATOR}>{roleLabels[Role.TRANSLATOR]}</option>
              <option value={Role.MANAGER}>{roleLabels[Role.MANAGER]}</option>
            </select>
            <button className="icon-btn" onClick={() => void addMember()} disabled={!addingUserId}>
              <Icon name="add" />
              {el.admin.addMember}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.get<AdminUserView[]>('/admin/users').then(setUsers).catch(() => setUsers([]));
  }

  useEffect(reload, []);

  async function deactivate(user: AdminUserView) {
    if (!confirm(el.admin.confirmDeactivate(user.username))) return;
    try {
      await api.patch(`/admin/users/${user.id}/deactivate`);
      reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  async function reactivate(user: AdminUserView) {
    try {
      await api.patch(`/admin/users/${user.id}/reactivate`);
      reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  if (!users) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div>
      {error && <div className="field-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      {users.length === 0 ? (
        <div className="card">
          <EmptyState title={el.admin.noUsers} />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{el.auth.username}</th>
                <th className="hide-narrow">{el.members.email}</th>
                <th className="hide-narrow">{el.admin.members}</th>
                <th>{el.members.memberSince}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const deactivated = !!u.deactivatedAt;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="row">
                        <Avatar username={u.username} avatarUrl={u.avatarUrl} size={26} />
                        {u.username}
                        {u.isAdmin && <span className="badge">{el.admin.admin}</span>}
                        {deactivated && <span className="badge warning">{el.admin.deactivated}</span>}
                      </div>
                    </td>
                    <td className="hide-narrow muted">{u.email}</td>
                    <td className="hide-narrow muted">
                      {u.memberships.map((m) => m.projectName).join(', ') || '—'}
                    </td>
                    <td className="muted">{formatDate(u.createdAt)}</td>
                    <td style={{ textAlign: 'end' }}>
                      {deactivated ? (
                        <button className="icon-btn" onClick={() => void reactivate(u)}>
                          <Icon name="refresh" />
                          {el.admin.reactivate}
                        </button>
                      ) : (
                        <button className="ghost danger icon-btn" onClick={() => void deactivate(u)}>
                          <Icon name="delete" />
                          {el.admin.deactivate}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
