import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CommentView, SourceStringView } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api } from '../lib/api.js';
import { Avatar, ThemeToggle, formatDate } from '../components/common.js';

interface StringsResponse {
  fileName: string;
  language: string;
  strings: SourceStringView[];
}

export function StringEditor() {
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>();
  const [data, setData] = useState<StringsResponse | null>(null);
  const [onlyUntranslated, setOnlyUntranslated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (projectId && fileId) {
      api
        .get<StringsResponse>(`/projects/${projectId}/files/${fileId}/strings`)
        .then(setData)
        .catch(() => setData(null));
    }
  }, [projectId, fileId]);

  const visible = useMemo(() => {
    if (!data) return [];
    return onlyUntranslated ? data.strings.filter((s) => !s.translation) : data.strings;
  }, [data, onlyUntranslated]);

  // Εικονικοποίηση: ένα αρχείο με 10.000 κείμενα δεν πρέπει να παγώνει τη σελίδα.
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  const updateLocal = useCallback((id: string, text: string) => {
    setData((current) =>
      current
        ? {
            ...current,
            strings: current.strings.map((s) =>
              s.id === id ? { ...s, translation: text, needsReview: false } : s,
            ),
          }
        : current,
    );
  }, []);

  if (!projectId || !fileId) return null;
  if (!data) return <div style={{ padding: '2rem' }}>{el.app.loading}</div>;

  const translated = data.strings.filter((s) => s.translation).length;

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
          <button
            className={onlyUntranslated ? 'primary' : ''}
            onClick={() => setOnlyUntranslated((v) => !v)}
          >
            {onlyUntranslated ? el.editor.all : el.editor.untranslated}
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="card"
        style={{ padding: 0, height: 'calc(100vh - 200px)', overflowY: 'auto' }}
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
                }}
              >
                <StringRow
                  projectId={projectId}
                  item={item}
                  language={data.language}
                  onSaved={updateLocal}
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
    </div>
  );
}

function StringRow({
  projectId,
  item,
  language,
  onSaved,
  expanded,
  onToggleComments,
}: {
  projectId: string;
  item: SourceStringView;
  language: string;
  onSaved: (id: string, text: string) => void;
  expanded: boolean;
  onToggleComments: () => void;
}) {
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
      onSaved(item.id, text);
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

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem' }}>
      <div className="spread" style={{ marginBottom: '0.4rem' }}>
        <code className="muted" style={{ fontSize: '0.82em' }}>
          {item.key}
        </code>
        <div className="row">
          {item.needsReview && (
            <span className="badge warning" title={el.editor.needsReviewHint}>
              {el.editor.needsReview}
            </span>
          )}
          {status === 'saved' && <span className="badge">{el.editor.saved}</span>}
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
            onBlur={() => void save()}
            placeholder={el.editor.placeholder}
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
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  function reload() {
    api
      .get<CommentView[]>(`/projects/${projectId}/strings/${stringId}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }

  useEffect(reload, [projectId, stringId]);

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
            <CommentNode key={comment.id} comment={comment} onReply={setReplyTo} />
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
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
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
}: {
  comment: CommentView;
  onReply: (id: string) => void;
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
          <div style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</div>
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
            <CommentNode key={reply.id} comment={reply} onReply={onReply} />
          ))}
        </div>
      )}
    </div>
  );
}
