import { useState } from 'react';
import { el } from '../i18n/el.js';

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {open ? (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.5 17.5 0 0 1-3.2 4.1M6.6 6.6A17.7 17.7 0 0 0 2 12s3.6 7 10 7a10.2 10.2 0 0 0 4.4-.98" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      )}
    </svg>
  );
}

/**
 * Πεδίο κωδικού με εικονίδιο εμφάνισης/απόκρυψης — αντικαθιστά το επαναλαμβανόμενο
 * <div className="field"><label/><input type="password"/></div> στο Login/Register/
 * ResetPassword.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required = true,
  autoFocus,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  required?: boolean;
  autoFocus?: boolean;
  error?: string | null;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="ghost toggle-visibility"
          onClick={() => setVisible((v) => !v)}
          title={visible ? el.auth.hidePassword : el.auth.showPassword}
          aria-label={visible ? el.auth.hidePassword : el.auth.showPassword}
        >
          <EyeIcon open={visible} />
        </button>
      </div>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
