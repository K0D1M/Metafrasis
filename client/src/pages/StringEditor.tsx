import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ThreeDots } from 'react-loader-spinner';
import type { CommentView, MemberView, SourceStringView } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api } from '../lib/api.js';
import { Avatar, ThemeToggle, formatDate } from '../components/common.js';
import { MentionTextarea } from '../components/MentionTextarea.js';
import { renderWithMentions } from '../lib/mentions.js';
import { useAuth } from '../lib/auth.js';

interface StringsResponse {
  fileName: string;
  language: string;
  strings: SourceStringView[];
}

// Εύρος χαρακτήρων αλφαβήτου ανά γλώσσα-στόχο, για να ξεχωρίζουμε ένα πραγματικά
// μεταφρασμένο κείμενο από κενό/λευκό χώρο ή κείμενο σε λάθος γλώσσα που τυχαία
// γράφτηκε στο πεδίο. Αρκεί ένας χαρακτήρας του αλφαβήτου-στόχου να υπάρχει.
const LANGUAGE_SCRIPTS: Record<string, RegExp> = {
  el: /[Ͱ-Ͽἀ-῿]/, // Ελληνικό αλφάβητο (και τονισμένα/πολυτονικά).
  en: /[a-zA-Z]/,
};

/** Το κείμενο θεωρείται πραγματική μετάφραση μόνο αν περιέχει έστω έναν χαρακτήρα του
 * αλφαβήτου της γλώσσας-στόχου — όχι απλώς αν το πεδίο δεν είναι κενό. */
function isActuallyTranslated(text: string | null | undefined, language: string): boolean {
  if (!text || !text.trim()) return false;
  const script = LANGUAGE_SCRIPTS[language];
  return script ? script.test(text) : text.trim().length > 0;
}

/** Ίδιος κανόνας με το server/src/services/progress.ts: ένα «Χρειάζεται έλεγχος» δεν
 * μετρά μέχρι να ελεγχθεί· ένα «δεν χρειάζεται μετάφραση» μετρά χωρίς κείμενο. */
function isDone(item: SourceStringView, language: string): boolean {
  if (item.needsReview) return false;
  return item.skipped || isActuallyTranslated(item.translation, language);
}

/** Χρόνος χάριτος πριν ένα μόλις ολοκληρωμένο κείμενο εξαφανιστεί από τη λίστα «Μη
 * μεταφρασμένα» — ώστε ο μεταφραστής να προλάβει να διορθώσει κάτι χωρίς να χάσει τη
 * θέση του στη λίστα. Αφορά μόνο αυτή τη φιλτραρισμένη προβολή στον client· η πρόοδος
 * (μπάρες, σύνολα project) ενημερώνεται κανονικά, αμέσως. */
const UNTRANSLATED_GRACE_MS = 15_000;

export function StringEditor() {
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>();
  const [data, setData] = useState<StringsResponse | null>(null);
  const [onlyUntranslated, setOnlyUntranslated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Απόσβεση: με 20.000+ κείμενα σε ένα αρχείο, φιλτράρισμα σε κάθε πάτημα πλήκτρου
  // θα ξανάτρεχε τον virtualizer πολύ συχνά. 150ms αρκεί ώστε να μη νιώθει καθυστέρηση.
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (projectId && fileId) {
      api
        .get<StringsResponse>(`/projects/${projectId}/files/${fileId}/strings`)
        .then(setData)
        .catch(() => setData(null));
    }
  }, [projectId, fileId]);

  // Κείμενα που μόλις ολοκληρώθηκαν σε αυτή τη σελίδα (id → πότε λήγει η χάρη). Μόνο
  // strings που έγιναν done ΕΝΩ η σελίδα ήταν ανοιχτή μπαίνουν εδώ — μια μετάφραση που
  // ήταν ήδη έτοιμη πριν το άνοιγμα της σελίδας δεν χρειάζεται χρόνο χάριτος, απλώς δεν
  // εμφανίζεται καθόλου στο φίλτρο.
  const recentlyCompletedRef = useRef<Map<string, number>>(new Map());
  const [graceTick, setGraceTick] = useState(0);

  const visible = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    // Καθαρισμός ληγμένων καταχωρήσεων πριν το φιλτράρισμα, ώστε μια ληγμένη χάρη να μην
    // κρατήσει το string στη λίστα ένα ακόμα render παραπάνω.
    for (const [id, expiresAt] of recentlyCompletedRef.current) {
      if (expiresAt <= now) recentlyCompletedRef.current.delete(id);
    }
    let result = onlyUntranslated
      ? data.strings.filter((s) => !isDone(s, data.language) || recentlyCompletedRef.current.has(s.id))
      : data.strings;
    if (query) {
      result = result.filter(
        (s) =>
          s.key.toLowerCase().includes(query) ||
          s.sourceText.toLowerCase().includes(query) ||
          (s.translation ?? '').toLowerCase().includes(query),
      );
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- graceTick προκαλεί επανυπολογισμό όταν λήγει μια χάρη, χωρίς να είναι πραγματική τιμή που διαβάζεται εδώ.
  }, [data, onlyUntranslated, query, graceTick]);

  // Χρονόμετρο μόνο όσο υπάρχει κάτι σε χρόνο χάριτος — ξαναϋπολογίζει το visible ώστε
  // ένα ληγμένο string να εξαφανιστεί χωρίς να χρειάζεται άλλη αλληλεπίδραση του χρήστη.
  useEffect(() => {
    if (recentlyCompletedRef.current.size === 0) return;
    const interval = setInterval(() => setGraceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [graceTick]);

  // Εικονικοποίηση: ένα αρχείο με 10.000 κείμενα δεν πρέπει να παγώνει τη σελίδα.
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  const { user } = useAuth();
  const [showRecent, setShowRecent] = useState(false);
  const recentLimit = user?.recentTranslationsCount ?? 10;

  // Οι πιο πρόσφατες μεταφράσεις του αρχείου, από οποιοδήποτε μέλος. Μόνο γραμμές με
  // πραγματικό κείμενο — ένα «Χωρίς μετάφραση» δεν είναι μετάφραση για να ξαναδεί κανείς.
  const recent = useMemo(() => {
    if (!data) return [];
    return data.strings
      .filter((s) => s.translatedAt && s.translation && s.translation.trim())
      .sort((a, b) => (b.translatedAt ?? '').localeCompare(a.translatedAt ?? ''))
      .slice(0, recentLimit);
  }, [data, recentLimit]);

  // Μετάβαση σε κείμενο από το πάνελ. Αν τα φίλτρα το κρύβουν, τα καθαρίζουμε πρώτα και
  // κάνουμε το scroll στο επόμενο render, αφού ξαναϋπολογιστεί το visible.
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  function jumpTo(id: string) {
    if (!visible.some((s) => s.id === id)) {
      setOnlyUntranslated(false);
      setSearchInput('');
      setQuery('');
    }
    setJumpTarget(id);
  }

  useEffect(() => {
    if (!jumpTarget) return;
    const index = visible.findIndex((s) => s.id === jumpTarget);
    if (index === -1) return;
    virtualizer.scrollToIndex(index, { align: 'center' });
    setHighlighted(jumpTarget);
    setJumpTarget(null);
    const timeout = setTimeout(() => setHighlighted(null), 2000);
    return () => clearTimeout(timeout);
  }, [jumpTarget, visible, virtualizer]);

  // Όσο ο μεταφραστής γράφει σε ένα κείμενο που είναι σε χρόνο χάριτος, η χάρη παγώνει
  // (Infinity)· ξεκινά από την αρχή μόλις βγει από το πεδίο.
  const onRowFocus = useCallback((id: string) => {
    if (recentlyCompletedRef.current.has(id)) recentlyCompletedRef.current.set(id, Infinity);
  }, []);

  const onRowBlur = useCallback((id: string) => {
    if (recentlyCompletedRef.current.has(id)) {
      recentlyCompletedRef.current.set(id, Date.now() + UNTRANSLATED_GRACE_MS);
      setGraceTick((t) => t + 1);
    }
  }, []);

  const updateLocal = useCallback((id: string, patch: Partial<SourceStringView>) => {
    setData((current) => {
      if (!current) return current;
      const strings = current.strings.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...patch };
        // Μόλις ένα string γίνει done ενώ η σελίδα είναι ανοιχτή, παίρνει χρόνο χάριτος
        // πριν εξαφανιστεί από τη λίστα «Μη μεταφρασμένα» — βλ. UNTRANSLATED_GRACE_MS.
        if (!isDone(s, current.language) && isDone(updated, current.language)) {
          recentlyCompletedRef.current.set(id, Date.now() + UNTRANSLATED_GRACE_MS);
          setGraceTick((t) => t + 1);
        } else if (!isDone(updated, current.language)) {
          // Ξαναέγινε μη μεταφρασμένο (π.χ. σβήστηκε το κείμενο) — δεν χρειάζεται πια χάρη.
          recentlyCompletedRef.current.delete(id);
        }
        return updated;
      });
      return { ...current, strings };
    });
  }, []);

  if (!projectId || !fileId) return null;
  if (!data)
    return (
      <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
        <ThreeDots color="#32cd32" height={60} width={60} />
      </div>
    );

  const translated = data.strings.filter((s) => isDone(s, data.language)).length;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          <Link to={`/projects/${projectId}`} className="muted">
            ← {el.editor.back}
          </Link>
          <h1 style={{ margin: '0.2rem 0 0' }}>{data.fileName}</h1>
          <span className="muted">
            {translated} / {data.strings.length}
          </span>
        </div>
        <div className="row">
          <div className="row" style={{ position: 'relative' }}>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={el.editor.searchPlaceholder}
              style={{ minWidth: 220, paddingRight: searchInput ? '2rem' : undefined }}
              aria-label={el.editor.searchPlaceholder}
            />
            {searchInput && (
              <button
                type="button"
                className="ghost"
                onClick={() => setSearchInput('')}
                title={el.editor.searchClear}
                aria-label={el.editor.searchClear}
                style={{ position: 'absolute', right: 0, padding: '0 0.5rem' }}
              >
                ✕
              </button>
            )}
          </div>
          <button
            className={onlyUntranslated ? 'primary' : ''}
            onClick={() => setOnlyUntranslated((v) => !v)}
          >
            {onlyUntranslated ? el.editor.all : el.editor.untranslated}
          </button>
          <button className={showRecent ? 'primary' : ''} onClick={() => setShowRecent((v) => !v)}>
            {el.editor.recent}
          </button>
          <ThemeToggle />
        </div>
      </div>

      {query && (
        <div className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.9em' }}>
          {el.editor.searchResults(visible.length)}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
      <div
        ref={scrollRef}
        className="card"
        style={{ padding: 0, height: 'calc(100vh - 200px)', overflowY: 'auto', flex: 1, minWidth: 0 }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = visible[row.index];
            if (!item) return null;
            return (
              <div
                key={item.id}
                ref={virtualizer.measureElement}
                data-index={row.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                  outline: highlighted === item.id ? '2px solid var(--accent)' : undefined,
                  outlineOffset: -2,
                }}
              >
                <StringRow
                  projectId={projectId}
                  index={row.index + 1}
                  item={item}
                  language={data.language}
                  onSaved={updateLocal}
                  onFocusRow={onRowFocus}
                  onBlurRow={onRowBlur}
                  expanded={selected === item.id}
                  onToggleComments={() =>
                    setSelected((current) => (current === item.id ? null : item.id))
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {showRecent && (
        <aside
          className="card"
          style={{ width: 320, flexShrink: 0, height: 'calc(100vh - 200px)', overflowY: 'auto', padding: '0.75rem' }}
          aria-label={el.editor.recent}
        >
          <div className="spread" style={{ marginBottom: '0.5rem' }}>
            <strong>{el.editor.recent}</strong>
            <button
              className="ghost"
              onClick={() => setShowRecent(false)}
              title={el.editor.recentClose}
              aria-label={el.editor.recentClose}
            >
              ✕
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="muted">{el.editor.recentEmpty}</div>
          ) : (
            <div className="stack" style={{ gap: '0.4rem' }}>
              {recent.map((s) => (
                <button
                  key={s.id}
                  className="ghost"
                  onClick={() => jumpTo(s.id)}
                  style={{ textAlign: 'start', display: 'block', width: '100%', padding: '0.5rem' }}
                >
                  <code className="muted" style={{ fontSize: '0.78em', wordBreak: 'break-all' }}>
                    {s.key}
                  </code>
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      margin: '0.15rem 0',
                    }}
                  >
                    {s.translation}
                  </div>
                  <div className="row muted" style={{ fontSize: '0.78em', gap: '0.35rem' }}>
                    {s.translatedBy && (
                      <Avatar
                        username={s.translatedBy.username}
                        avatarUrl={s.translatedBy.avatarUrl}
                        size={18}
                      />
                    )}
                    {s.translatedBy?.username} · {s.translatedAt && formatDate(s.translatedAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
      </div>
    </div>
  );
}

function StringRow({
  projectId,
  index,
  item,
  language,
  onSaved,
  onFocusRow,
  onBlurRow,
  expanded,
  onToggleComments,
}: {
  projectId: string;
  index: number;
  item: SourceStringView;
  language: string;
  onSaved: (id: string, patch: Partial<SourceStringView>) => void;
  onFocusRow: (id: string) => void;
  onBlurRow: (id: string) => void;
  expanded: boolean;
  onToggleComments: () => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState(item.translation ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copied, setCopied] = useState(false);

  // Το πεδίο ακολουθεί την εξωτερική τιμή όταν αλλάζει από αλλού (π.χ. επαναφόρτωση).
  useEffect(() => setText(item.translation ?? ''), [item.translation]);

  async function save() {
    if (text === (item.translation ?? '')) return;
    setStatus('saving');
    try {
      await api.put(`/projects/${projectId}/strings/${item.id}/translation`, { text, language });
      onSaved(item.id, {
        translation: text,
        needsReview: false,
        skipped: false,
        translatedAt: new Date().toISOString(),
        translatedBy: user ? { username: user.username, avatarUrl: user.avatarUrl } : item.translatedBy,
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('idle');
    }
  }

  async function copySource() {
    try {
      await navigator.clipboard.writeText(item.sourceText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Χωρίς άδεια clipboard, το κείμενο είναι ήδη ορατό για χειροκίνητη αντιγραφή.
    }
  }

  /** Επιβεβαίωση ελέγχου χωρίς αλλαγή στη μετάφραση — π.χ. το πρωτότυπο άλλαξε ελάχιστα
   * και η υπάρχουσα μετάφραση παραμένει σωστή. */
  async function confirmReviewed() {
    try {
      await api.patch(`/projects/${projectId}/strings/${item.id}/review`);
      onSaved(item.id, { needsReview: false });
    } catch {
      // Αν αποτύχει, το badge παραμένει — ο χρήστης μπορεί να ξαναδοκιμάσει.
    }
  }

  async function toggleSkipped() {
    const skipped = !item.skipped;
    try {
      await api.put(`/projects/${projectId}/strings/${item.id}/skip`, { language, skipped });
      setText('');
      onSaved(
        item.id,
        skipped ? { skipped, translation: '', needsReview: false } : { skipped, translation: null },
      );
    } catch {
      // Η κατάσταση μένει ως είχε — ο χρήστης μπορεί να ξαναδοκιμάσει.
    }
  }

  return (
    <div
      className={`string-row${item.skipped ? ' ignored' : ''}`}
      style={{ borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem' }}
    >
      <div className="spread" style={{ marginBottom: '0.4rem' }}>
        <div className="row" style={{ gap: '0.5rem' }}>
          <span className="muted" style={{ fontSize: '0.82em', minWidth: '2ch', textAlign: 'end' }}>
            {index}
          </span>
          <code className="muted" style={{ fontSize: '0.82em' }}>
            {item.key}
          </code>
        </div>
        <div className="row">
          {item.needsReview && (
            <>
              <span className="badge warning" title={el.editor.needsReviewHint}>
                {el.editor.needsReview}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => void confirmReviewed()}
                title={el.editor.confirmReview}
                aria-label={el.editor.confirmReview}
              >
                ✓
              </button>
            </>
          )}
          {status === 'saved' && <span className="badge">{el.editor.saved}</span>}
          {item.skipped && <span className="badge ignored">{el.editor.skipped}</span>}
          <button
            type="button"
            className={item.skipped ? '' : 'ghost'}
            onClick={() => void toggleSkipped()}
            title={item.skipped ? el.editor.unskipHint : el.editor.skipHint}
          >
            {item.skipped ? el.editor.unskip : el.editor.skip}
          </button>
          <button className="ghost" onClick={onToggleComments}>
            {el.editor.comments}
            {item.commentCount > 0 ? ` (${item.commentCount})` : ''}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <div>
          <label>{el.editor.source}</label>
          <div
            className="card reveal-on-hover"
            style={{ background: 'var(--surface-2)', minHeight: 44, whiteSpace: 'pre-wrap' }}
          >
            {item.sourceText}
            <button
              type="button"
              className="ghost hover-action"
              onClick={() => void copySource()}
              title={el.editor.copySource}
              aria-label={el.editor.copySource}
            >
              {copied ? '✓' : '⧉'}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor={`t-${item.id}`}>{el.editor.target}</label>
          <textarea
            id={`t-${item.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => onFocusRow(item.id)}
            onBlur={() => {
              onBlurRow(item.id);
              void save();
            }}
            placeholder={item.skipped ? el.editor.skippedPlaceholder : el.editor.placeholder}
            style={{ minHeight: 44 }}
          />
        </div>
      </div>

      {expanded && <CommentThread projectId={projectId} stringId={item.id} />}
    </div>
  );
}

function CommentThread({ projectId, stringId }: { projectId: string; stringId: string }) {
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  function reload() {
    api
      .get<CommentView[]>(`/projects/${projectId}/strings/${stringId}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }

  useEffect(reload, [projectId, stringId]);
  useEffect(() => {
    api
      .get<MemberView[]>(`/projects/${projectId}/members`)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [projectId]);

  const validUsernames = useMemo(() => new Set(members.map((m) => m.username)), [members]);

  async function send() {
    if (!body.trim()) return;
    await api.post(`/projects/${projectId}/strings/${stringId}/comments`, {
      body,
      parentId: replyTo,
    });
    setBody('');
    setReplyTo(null);
    reload();
  }

  return (
    <div className="card" style={{ marginTop: '0.75rem', background: 'var(--surface-2)' }}>
      {comments === null ? (
        <div className="muted">{el.app.loading}</div>
      ) : comments.length === 0 ? (
        <div className="muted">{el.editor.noComments}</div>
      ) : (
        <div className="stack" style={{ gap: '0.6rem' }}>
          {comments.map((comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              onReply={setReplyTo}
              validUsernames={validUsernames}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        {replyTo && (
          <div className="row muted" style={{ marginBottom: '0.3rem' }}>
            <span>{el.editor.reply}</span>
            <button className="ghost" onClick={() => setReplyTo(null)}>
              ✕
            </button>
          </div>
        )}
        <MentionTextarea
          value={body}
          onChange={setBody}
          members={members}
          placeholder={el.editor.addComment}
          style={{ minHeight: 56 }}
        />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.4rem' }}>
          <button className="primary" onClick={() => void send()} disabled={!body.trim()}>
            {el.editor.send}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentNode({
  comment,
  onReply,
  validUsernames,
}: {
  comment: CommentView;
  onReply: (id: string) => void;
  validUsernames: ReadonlySet<string>;
}) {
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar username={comment.author.username} avatarUrl={comment.author.avatarUrl} size={26} />
        <div style={{ flex: 1 }}>
          <div className="row">
            <strong>{comment.author.username}</strong>
            <span className="muted" style={{ fontSize: '0.85em' }}>
              {formatDate(comment.createdAt)}
            </span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {renderWithMentions(comment.body, validUsernames)}
          </div>
          <button className="ghost muted" style={{ padding: '0.1rem 0' }} onClick={() => onReply(comment.id)}>
            {el.editor.reply}
          </button>
        </div>
      </div>

      {comment.replies.length > 0 && (
        <div
          className="stack"
          style={{ gap: '0.6rem', marginInlineStart: '2rem', marginTop: '0.6rem' }}
        >
          {comment.replies.map((reply) => (
            <CommentNode key={reply.id} comment={reply} onReply={onReply} validUsernames={validUsernames} />
          ))}
        </div>
      )}
    </div>
  );
}
