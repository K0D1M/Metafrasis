import { useRef, useState, type KeyboardEvent } from 'react';
import type { MemberView } from '@metafrasis/shared';
import { Avatar } from './common.js';

/** Ταιριάζει ένα ημιτελές @όνομα ακριβώς πριν τον δρομέα, για το dropdown πρότασης. */
const PARTIAL_MENTION = /@(\w*)$/;

/**
 * <textarea> με αυτόματη πρόταση @αναφοράς σε μέλη του project. Ελεγχόμενο component
 * (value/onChange) όπως κάθε άλλο textarea σε αυτή την εφαρμογή — απλά προσθέτει το
 * dropdown από πάνω, χωρίς να αλλάζει τη γύρω λογική υποβολής σχολίου.
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  placeholder,
  style,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MemberView[];
  placeholder?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches =
    query === null
      ? []
      : members.filter((m) => m.username.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);

  function syncQuery(text: string, cursor: number) {
    const before = text.slice(0, cursor);
    const match = before.match(PARTIAL_MENTION);
    setQuery(match ? (match[1] ?? '') : null);
    setHighlighted(0);
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
    syncQuery(event.target.value, event.target.selectionStart ?? event.target.value.length);
  }

  function insertMention(username: string) {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const replaced = before.replace(PARTIAL_MENTION, `@${username} `);
    const next = replaced + after;
    onChange(next);
    setQuery(null);
    // Το selection πρέπει να μετακινηθεί μετά το νέο κείμενο, στο επόμενο tick — το
    // React δεν έχει ακόμα ξαναγράψει την τιμή του DOM input τη στιγμή αυτού του κλικ.
    requestAnimationFrame(() => {
      const pos = replaced.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((h) => (h + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((h) => (h - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertMention(matches[highlighted]!.username);
    } else if (event.key === 'Escape') {
      setQuery(null);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) => syncQuery(value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        placeholder={placeholder}
        style={style}
        autoFocus={autoFocus}
      />
      {matches.length > 0 && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            width: 220,
            zIndex: 30,
            padding: '0.3rem',
            boxShadow: 'var(--shadow)',
          }}
        >
          {matches.map((m, index) => (
            <button
              key={m.userId}
              type="button"
              className="ghost"
              onMouseDown={(e) => {
                // preventDefault: αλλιώς το blur του textarea προλαβαίνει το click.
                e.preventDefault();
                insertMention(m.username);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                width: '100%',
                textAlign: 'start',
                background: index === highlighted ? 'var(--surface-2)' : 'transparent',
              }}
            >
              <Avatar username={m.username} avatarUrl={m.avatarUrl} size={20} />
              {m.username}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
