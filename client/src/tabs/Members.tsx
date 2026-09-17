import { useEffect, useState, type FormEvent } from 'react';
import {
  Role,
  roleLabels,
  type InviteResult,
  type MemberView,
} from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { Avatar, Modal, formatDate } from '../components/common.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

export function MembersTab({ project }: { project: ProjectDetail }) {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MemberView | null>(null);

  const isManager = project.role === Role.MANAGER;

  function reload() {
    api
      .get<MemberView[]>(`/projects/${project.id}/members`)
      .then(setMembers)
      .catch(() => setMembers([]));
  }

  useEffect(reload, [project.id]);

  if (!members) return <div className="card muted">{el.app.loading}</div>;

  return (
    <div>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{el.members.title}</h2>
        {isManager && (
          <button className="primary" onClick={() => setAdding(true)}>
            {el.members.add}
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{el.auth.username}</th>
              {isManager && <th className="hide-narrow">{el.members.email}</th>}
              <th>{el.members.role}</th>
              <th>{el.members.memberSince}</th>
              {isManager && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>
                  <div className="row">
                    <Avatar
                      username={member.username}
                      avatarUrl={member.avatarUrl}
                      size={28}
                    />
                    {member.username}
                  </div>
                </td>
                {isManager && <td className="hide-narrow muted">{member.email}</td>}
                <td>
                  <span className="badge">{roleLabels[member.role]}</span>
                </td>
                <td className="muted">{formatDate(member.joinedAt)}</td>
                {isManager && (
                  <td style={{ textAlign: 'end' }}>
                    <button className="ghost" onClick={() => setEditing(member)}>
                      ⋯
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <AddMemberModal projectId={project.id} onClose={() => setAdding(false)} />}
      {editing && (
        <EditMemberModal
          projectId={project.id}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** «Προσθήκη μέλους»: email, μήνυμα, επιλογή ρόλου, δημιουργία συνδέσμου. */
function AddMemberModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<Role>(Role.TRANSLATOR);
  // Η ενότητα «Επιλογή ρόλου» ανοίγει μέσα στο ίδιο παράθυρο, όπως ζητήθηκε.
  const [showRoles, setShowRoles] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setResult(
        await api.post<InviteResult>(`/projects/${projectId}/invites`, {
          email,
          role,
          ...(message ? { message } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Χωρίς άδεια clipboard, ο σύνδεσμος είναι ήδη ορατός για χειροκίνητη αντιγραφή.
    }
  }

  return (
    <Modal title={el.members.addTitle} onClose={onClose}>
      {result ? (
        <div className="stack">
          <div>{el.members.linkReady}</div>
          <div className="card" style={{ wordBreak: 'break-all', background: 'var(--surface-2)' }}>
            {result.url}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => void copyLink()}>
              {copied ? el.members.copied : el.members.copy}
            </button>
            <button className="primary" onClick={onClose}>
              {el.app.close}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <button
            type="button"
            onClick={() => setShowRoles((v) => !v)}
            style={{ marginBottom: '1rem' }}
          >
            {el.members.chooseRole}: {roleLabels[role]}
          </button>

          {showRoles && (
            <div className="stack" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
              <RoleOption
                value={Role.MANAGER}
                current={role}
                onSelect={setRole}
                description={el.members.managerDescription}
              />
              <RoleOption
                value={Role.TRANSLATOR}
                current={role}
                onSelect={setRole}
                description={el.members.translatorDescription}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="invite-email">{el.members.email}</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="invite-message">{el.members.message}</label>
            <textarea
              id="invite-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {error && <div className="field-error">{error}</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>
              {el.app.cancel}
            </button>
            <button type="submit" className="primary" disabled={busy || !email.trim()}>
              {busy ? el.app.loading : el.members.createLink}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RoleOption({
  value,
  current,
  onSelect,
  description,
}: {
  value: Role;
  current: Role;
  onSelect: (role: Role) => void;
  description: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      style={{
        textAlign: 'start',
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active ? 'var(--surface-2)' : 'var(--surface)',
      }}
    >
      <strong>{roleLabels[value]}</strong>
      <div className="muted">{description}</div>
    </button>
  );
}

/** Το όνομα χρήστη το αλλάζει μόνο ο διαχειριστής (απαίτηση προδιαγραφής). */
function EditMemberModal({
  projectId,
  member,
  onClose,
  onSaved,
}: {
  projectId: string;
  member: MemberView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(member.username);
  const [role, setRole] = useState<Role>(member.role);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.patch(`/projects/${projectId}/members/${member.userId}`, { username, role });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  async function remove() {
    if (!confirm(`${el.members.remove}: ${member.username}?`)) return;
    setError(null);
    try {
      await api.delete(`/projects/${projectId}/members/${member.userId}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  return (
    <Modal title={member.username} onClose={onClose}>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="member-username">{el.auth.username}</label>
          <input
            id="member-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="member-role">{el.members.role}</label>
          <select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value={Role.MANAGER}>{roleLabels[Role.MANAGER]}</option>
            <option value={Role.TRANSLATOR}>{roleLabels[Role.TRANSLATOR]}</option>
          </select>
        </div>

        {error && <div className="field-error">{error}</div>}

        <div className="spread">
          <button type="button" className="ghost danger" onClick={() => void remove()}>
            {el.members.remove}
          </button>
          <div className="row">
            <button type="button" onClick={onClose}>
              {el.app.cancel}
            </button>
            <button type="submit" className="primary">
              {el.app.save}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
