import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Role, type FolderNode, type SourceFileSummary } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { EmptyState, Modal, ProgressBar, formatDate } from '../components/common.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

interface SourcesResponse {
  folders: FolderNode[];
  files: SourceFileSummary[];
}

export function SourcesTab({
  project,
  onChanged,
}: {
  project: ProjectDetail;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  // null = «Χωρίς φάκελο» (ρίζα). Επιλέγει ποιος φάκελος φιλτράρει τη λίστα αρχείων
  // και μέσα σε ποιον ανεβαίνει το επόμενο «Προσθήκη Αρχείου».
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Ένα input για νέα αρχεία και ένα για Ενημέρωση υπάρχοντος.
  const addInput = useRef<HTMLInputElement>(null);
  const updateInput = useRef<HTMLInputElement>(null);
  const [updatingFileId, setUpdatingFileId] = useState<string | null>(null);

  const isManager = project.role === Role.MANAGER;

  function reload() {
    api
      .get<SourcesResponse>(`/projects/${project.id}/files`)
      .then(setData)
      .catch(() => setData({ folders: [], files: [] }));
  }

  useEffect(reload, [project.id]);

  async function handleAdd(file: File) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.upload(
        `/projects/${project.id}/files`,
        file,
        selectedFolderId ? { folderId: selectedFolderId } : {},
      );
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.sources.uploadError);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(fileId: string, file: File) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api.upload<{ added: number; changed: number; removed: number }>(
        `/projects/${project.id}/files/${fileId}/revisions`,
        file,
      );
      setNotice(el.sources.updated(result.added, result.changed, result.removed));
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.sources.uploadError);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(file: SourceFileSummary) {
    if (!confirm(el.sources.confirmDelete(file.name))) return;
    try {
      await api.delete(`/projects/${project.id}/files/${file.id}`);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
    }
  }

  if (!data) return <div className="card muted">{el.app.loading}</div>;

  // Αν διαγράφηκε ο επιλεγμένος φάκελος από άλλη ενέργεια, γυρίζουμε στη ρίζα.
  const validSelection =
    selectedFolderId === null || data.folders.some((f) => f.id === selectedFolderId);
  const activeFolderId = validSelection ? selectedFolderId : null;
  const visibleFiles = data.files.filter((f) => f.folderId === activeFolderId);

  return (
    <div>
      {/* Τα κουμπιά «στα δεξιά», όπως ζητήθηκε. */}
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          {busy && <span className="badge">{el.sources.uploading}</span>}
          {notice && <span className="badge">{notice}</span>}
          {error && <span className="field-error">{error}</span>}
        </div>
        {isManager && (
          <div className="row">
            <button onClick={() => setCreatingFolder(true)} disabled={busy}>
              {el.sources.newFolder}
            </button>
            <button className="primary" onClick={() => addInput.current?.click()} disabled={busy}>
              {busy && !updatingFileId ? el.app.loading : el.sources.addFile}
            </button>
          </div>
        )}
      </div>

      <input
        ref={addInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleAdd(file);
          // Καθαρίζουμε την τιμή ώστε το ίδιο αρχείο να μπορεί να ξαναεπιλεγεί.
          event.target.value = '';
        }}
      />
      <input
        ref={updateInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && updatingFileId) void handleUpdate(updatingFileId, file);
          event.target.value = '';
          setUpdatingFileId(null);
        }}
      />

      {data.files.length === 0 && data.folders.length === 0 ? (
        <div className="card">
          <EmptyState title={el.sources.empty} hint={el.sources.emptyHint} />
        </div>
      ) : (
        <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
          {/* Λίστα φακέλων: το «Νέος Φάκελος» έκανε ήδη τη δουλειά του στον server, απλά
              δεν υπήρχε πουθενά να φαίνεται το αποτέλεσμα — αυτό είναι η διόρθωση. */}
          <div className="card" style={{ width: 200, flexShrink: 0, padding: '0.5rem' }}>
            <FolderRow
              label={el.sources.rootFolder}
              active={activeFolderId === null}
              onClick={() => setSelectedFolderId(null)}
              count={data.files.filter((f) => f.folderId === null).length}
            />
            {data.folders.length === 0 ? (
              <div className="muted" style={{ padding: '0.5rem 0.6rem', fontSize: '0.85em' }}>
                {el.sources.noFolders}
              </div>
            ) : (
              data.folders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  label={folder.name}
                  active={activeFolderId === folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  count={data.files.filter((f) => f.folderId === folder.id).length}
                />
              ))
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {visibleFiles.length === 0 ? (
              <div className="card">
                <EmptyState title={el.sources.empty} hint={el.sources.emptyHint} />
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>{el.sources.addFile.replace('Προσθήκη ', '')}</th>
                      <th>{el.sources.strings}</th>
                      <th>{el.sources.revision}</th>
                      <th style={{ minWidth: 140 }}>{el.dashboard.progress}</th>
                      <th className="hide-narrow">{el.members.memberSince}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFiles.map((file) => (
                      <tr key={file.id}>
                        <td>
                          <button
                            className="ghost"
                            style={{ padding: 0, color: 'var(--accent)' }}
                            onClick={() => navigate(`/projects/${project.id}/files/${file.id}`)}
                          >
                            {file.name}
                          </button>
                        </td>
                        <td>{file.stringCount}</td>
                        <td>{file.revision}</td>
                        <td>
                          <ProgressBar progress={file.progress} showLabel={false} />
                          <span className="muted" style={{ fontSize: '0.85em' }}>
                            {file.progress.translated}/{file.progress.total}
                          </span>
                        </td>
                        <td className="hide-narrow muted">{formatDate(file.updatedAt)}</td>
                        <td>
                          {isManager && (
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => {
                                  setUpdatingFileId(file.id);
                                  updateInput.current?.click();
                                }}
                                disabled={busy}
                              >
                                {busy && updatingFileId === file.id
                                  ? el.app.loading
                                  : el.sources.update}
                              </button>
                              <button
                                className="ghost danger"
                                onClick={() => void handleDelete(file)}
                                title={el.sources.deleteFile}
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {creatingFolder && (
        <NewFolderModal
          projectId={project.id}
          onClose={() => setCreatingFolder(false)}
          onCreated={(folder) => {
            setCreatingFolder(false);
            setSelectedFolderId(folder.id);
            reload();
          }}
        />
      )}
    </div>
  );
}

function FolderRow({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      className={active ? 'primary' : 'ghost'}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'start',
        justifyContent: 'space-between',
        display: 'flex',
        marginBottom: '0.25rem',
      }}
    >
      <span>📁 {label}</span>
      <span className={active ? '' : 'muted'}>{count}</span>
    </button>
  );
}

function NewFolderModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (folder: FolderNode) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const folder = await api.post<FolderNode>(`/projects/${projectId}/files/folders`, { name });
      onCreated(folder);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
      setBusy(false);
    }
  }

  return (
    <Modal title={el.sources.newFolder} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="folder-name">{el.sources.folderName}</label>
          <input
            id="folder-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        {error && <div className="field-error">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            {el.app.cancel}
          </button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            {busy ? el.app.loading : el.app.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
