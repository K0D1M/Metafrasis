import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThreeDots } from 'react-loader-spinner';
import { Role, type FolderNode, type SourceFileSummary, type UploadJob } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { EmptyState, Modal, ProgressBar, formatDate } from '../components/common.js';
import { DropZone } from '../components/DropZone.js';
import { Icon } from '../components/Icon.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

interface SourcesResponse {
  folders: FolderNode[];
  files: SourceFileSummary[];
}

// Ο server στέλνει πραγματικό ποσοστό (και κατά την αποθήκευση, ανά παρτίδα)· αυτός ο
// πίνακας είναι μόνο εφεδρεία αν κάποια γραμμή έρθει χωρίς ποσοστό.
const STAGE_PERCENT: Record<string, number> = {
  parsing: 10,
  diffing: 25,
  saving: 30,
};

function toPercent(stage: string, percent?: number): number {
  return percent ?? STAGE_PERCENT[stage] ?? 10;
}

/** Μπάρα προόδου με το ποσοστό γραμμένο μέσα της — κοινή για add και Ενημέρωση. */
function StagePercentBar({ percent }: { percent: number }) {
  return (
    <div
      className="progress-track"
      style={{ width: 90, height: 16, position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      <div className="progress-fill" style={{ width: `${percent}%`, height: '100%' }} />
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.7em',
          fontWeight: 600,
          color: 'var(--text)',
          lineHeight: 1,
        }}
      >
        {percent}%
      </span>
    </div>
  );
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
  const [renamingFolder, setRenamingFolder] = useState<FolderNode | null>(null);
  const [movingFile, setMovingFile] = useState<SourceFileSummary | null>(null);
  // Σύνολο κλειδιών ενεργειών που τρέχουν αυτή τη στιγμή: 'add' = ανέβασμα νέου αρχείου,
  // 'update:<fileId>' = Ενημέρωση συγκεκριμένου αρχείου. Σύνολο (όχι μονή τιμή) επειδή
  // μετά από ανανέωση σελίδας μπορεί να αποκατασταθεί παραπάνω από ένα ενεργό job
  // ταυτόχρονα (π.χ. ένα add ΚΑΙ μια Ενημέρωση από άλλον διαχειριστή). Μόνο το
  // κουμπί/στοιχείο που πραγματικά κάνει κάτι κλειδώνει — όχι όλη η καρτέλα.
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  // Στάδιο επεξεργασίας για το «Προσθήκη Αρχείου» (ξεχωριστό από τα updates παρακάτω).
  const [addStage, setAddStage] = useState<number | null>(null);
  // Στάδιο επεξεργασίας ανά αρχείο για την Ενημέρωση — fileId -> στάδιο.
  const [updateStages, setUpdateStages] = useState<Record<string, number>>({});

  function markInFlight(key: string) {
    setInFlight((current) => new Set(current).add(key));
  }
  function clearInFlight(key: string) {
    setInFlight((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }
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

  // Αν η σελίδα ανανεώθηκε ενώ έτρεχε ένα ή περισσότερα ανεβάσματα/ενημερώσεις, ο server
  // τα θυμάται ακόμα (in-memory tracker) — ρωτάμε μία φορά στο mount και, αν κάτι τρέχει,
  // ξαναδείχνουμε τη μπάρα και κάνουμε polling μέχρι να τελειώσουν όλα, αντί να χάνεται η
  // ένδειξη προόδου σε κάθε reload.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const jobs = await api.get<UploadJob[]>(`/projects/${project.id}/files/active-uploads`);
        if (cancelled) return;

        let stillRunning = false;
        for (const job of jobs) {
          const key = job.fileId ? `update:${job.fileId}` : 'add';
          if (job.stage === 'error') {
            setError(job.error ?? el.sources.uploadError);
            clearInFlight(key);
            if (!job.fileId) setAddStage(null);
            else setUpdateStages((s) => { const next = { ...s }; delete next[job.fileId!]; return next; });
            continue;
          }
          if (job.stage === 'done') {
            clearInFlight(key);
            if (!job.fileId) setAddStage(null);
            else setUpdateStages((s) => { const next = { ...s }; delete next[job.fileId!]; return next; });
            reload();
            onChanged();
            continue;
          }
          stillRunning = true;
          markInFlight(key);
          const percent = toPercent(job.stage, job.percent);
          if (!job.fileId) setAddStage(percent);
          else setUpdateStages((s) => ({ ...s, [job.fileId!]: percent }));
        }

        if (stillRunning) timer = setTimeout(poll, 1000);
      } catch {
        // Δίκτυο/σφάλμα ανάγνωσης: δεν έχει νόημα να μπλοκάρουμε την καρτέλα εξαιτίας του.
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function handleAdd(file: File) {
    setError(null);
    setNotice(null);
    markInFlight('add');
    setAddStage(10);
    try {
      await api.uploadStreamed(
        `/projects/${project.id}/files`,
        file,
        selectedFolderId ? { folderId: selectedFolderId } : {},
        (stage, percent) => setAddStage(toPercent(stage, percent)),
      );
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.sources.uploadError);
    } finally {
      clearInFlight('add');
      setAddStage(null);
    }
  }

  async function handleUpdate(fileId: string, file: File) {
    setError(null);
    setNotice(null);
    const key = `update:${fileId}`;
    markInFlight(key);
    setUpdateStages((s) => ({ ...s, [fileId]: 10 }));
    try {
      const result = await api.uploadStreamed<{ added: number; changed: number; removed: number }>(
        `/projects/${project.id}/files/${fileId}/revisions`,
        file,
        {},
        (stage, percent) => setUpdateStages((s) => ({ ...s, [fileId]: toPercent(stage, percent) })),
      );
      setNotice(el.sources.updated(result.added, result.changed, result.removed));
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.sources.uploadError);
    } finally {
      clearInFlight(key);
      setUpdateStages((s) => {
        const next = { ...s };
        delete next[fileId];
        return next;
      });
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

  async function handleDeleteFolder(folder: FolderNode) {
    if (!confirm(el.sources.confirmDeleteFolder(folder.name))) return;
    try {
      await api.delete(`/projects/${project.id}/files/folders/${folder.id}`);
      setSelectedFolderId(null);
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
  const activeFolder = data.folders.find((f) => f.id === activeFolderId) ?? null;

  return (
    <div>
      {/* Τα κουμπιά «στα δεξιά», όπως ζητήθηκε. Μόνο η ενέργεια που τρέχει πραγματικά
          κλειδώνει το δικό της στοιχείο — η υπόλοιπη καρτέλα μένει διαδραστική. */}
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          {inFlight.has('add') && (
            <span className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              <StagePercentBar percent={addStage ?? 10} />
              <ThreeDots color="#32cd32" height={20} width={20} />
              <span className="badge success">{el.sources.processing}</span>
            </span>
          )}
          {notice && <span className="badge">{notice}</span>}
          {error && <span className="field-error">{error}</span>}
        </div>
        {isManager && (
          <div className="row">
            {activeFolder && (
              <>
                <button className="ghost icon-btn" onClick={() => setRenamingFolder(activeFolder)}>
                  <Icon name="edit" />
                  {el.sources.renameFolder}
                </button>
                <button
                  className="ghost danger icon-btn"
                  onClick={() => void handleDeleteFolder(activeFolder)}
                >
                  <Icon name="delete" />
                  {el.sources.deleteFolder}
                </button>
              </>
            )}
            <button className="icon-btn" onClick={() => setCreatingFolder(true)}>
              <Icon name="folder" />
              {el.sources.newFolder}
            </button>
            <button
              className="primary icon-btn"
              onClick={() => addInput.current?.click()}
              disabled={inFlight.has('add')}
            >
              <Icon name="upload" />
              {inFlight.has('add') ? el.app.loading : el.sources.addFile}
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
            <DropZone
              accept="application/json,.json"
              disabled={!isManager || inFlight.has('add')}
              onFiles={(files) => {
                // Ίδια σημασιολογία με το κουμπί «Προσθήκη Αρχείου»: ένα αρχείο τη φορά.
                const file = files[0];
                if (file) void handleAdd(file);
              }}
            >
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
                        <th className="hide-narrow">{el.sources.updatedByHeader}</th>
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
                          <td className="hide-narrow muted">
                            {el.sources.updatedBy(
                              file.updatedBy?.username ?? '—',
                              formatDate(file.updatedAt),
                            )}
                          </td>
                          <td>
                            {isManager && (
                              <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                                {inFlight.has(`update:${file.id}`) && (
                                  <>
                                    <StagePercentBar percent={updateStages[file.id] ?? 10} />
                                    <ThreeDots color="#32cd32" height={18} width={18} />
                                    <span className="badge success">{el.sources.processing}</span>
                                  </>
                                )}
                                <button
                                  className="icon-btn"
                                  onClick={() => {
                                    setUpdatingFileId(file.id);
                                    updateInput.current?.click();
                                  }}
                                  disabled={inFlight.has(`update:${file.id}`)}
                                >
                                  <Icon name="refresh" />
                                  {inFlight.has(`update:${file.id}`)
                                    ? el.app.loading
                                    : el.sources.update}
                                </button>
                                <button
                                  className="ghost icon-btn"
                                  onClick={() => setMovingFile(file)}
                                  title={el.sources.moveFile}
                                  disabled={inFlight.has(`update:${file.id}`)}
                                >
                                  <Icon name="folder" />
                                  {el.sources.move}
                                </button>
                                <button
                                  className="ghost danger"
                                  onClick={() => void handleDelete(file)}
                                  title={el.sources.deleteFile}
                                  disabled={inFlight.has(`update:${file.id}`)}
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
            </DropZone>
          </div>
        </div>
      )}

      {creatingFolder && (
        <FolderNameModal
          projectId={project.id}
          onClose={() => setCreatingFolder(false)}
          onSaved={(folder) => {
            setCreatingFolder(false);
            setSelectedFolderId(folder.id);
            reload();
          }}
        />
      )}

      {renamingFolder && (
        <FolderNameModal
          projectId={project.id}
          folder={renamingFolder}
          onClose={() => setRenamingFolder(null)}
          onSaved={() => {
            setRenamingFolder(null);
            reload();
          }}
        />
      )}

      {movingFile && (
        <MoveFileModal
          projectId={project.id}
          file={movingFile}
          folders={data.folders}
          onClose={() => setMovingFile(null)}
          onMoved={(folderId) => {
            setMovingFile(null);
            setSelectedFolderId(folderId);
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

/** Νέος φάκελος, ή μετονομασία όταν δοθεί `folder`. */
function FolderNameModal({
  projectId,
  folder,
  onClose,
  onSaved,
}: {
  projectId: string;
  folder?: FolderNode;
  onClose: () => void;
  onSaved: (folder: FolderNode) => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const saved = folder
        ? await api.patch<FolderNode>(`/projects/${projectId}/files/folders/${folder.id}`, { name })
        : await api.post<FolderNode>(`/projects/${projectId}/files/folders`, { name });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
      setBusy(false);
    }
  }

  return (
    <Modal title={folder ? el.sources.renameFolder : el.sources.newFolder} onClose={onClose}>
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
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy}>
            <Icon name="cancel" />
            {el.app.cancel}
          </button>
          <button
            type="submit"
            className="primary icon-btn"
            disabled={busy || !name.trim() || name.trim() === folder?.name}
          >
            <Icon name="save" />
            {busy ? el.app.loading : el.app.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveFileModal({
  projectId,
  file,
  folders,
  onClose,
  onMoved,
}: {
  projectId: string;
  file: SourceFileSummary;
  folders: FolderNode[];
  onClose: () => void;
  onMoved: (folderId: string | null) => void;
}) {
  // '' = «Χωρίς φάκελο» (το <select> δεν δέχεται null ως τιμή).
  const [target, setTarget] = useState(file.folderId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unchanged = target === (file.folderId ?? '');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const folderId = target || null;
      await api.patch(`/projects/${projectId}/files/${file.id}/move`, { folderId });
      onMoved(folderId);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : el.app.error);
      setBusy(false);
    }
  }

  return (
    <Modal title={el.sources.moveTitle(file.name)} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="move-target">{el.sources.moveTo}</label>
          <select id="move-target" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus>
            <option value="">{el.sources.rootFolder}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="field-error">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy}>
            <Icon name="cancel" />
            {el.app.cancel}
          </button>
          <button type="submit" className="primary icon-btn" disabled={busy || unchanged}>
            <Icon name="folder" />
            {busy ? el.app.loading : el.sources.move}
          </button>
        </div>
      </form>
    </Modal>
  );
}
