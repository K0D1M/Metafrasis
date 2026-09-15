/**
 * Εικονίδια καρτελών του project (Dashboard, Πηγές, ...) — συμπαγές (filled) στυλ,
 * επιλεγμένο από τον χρήστη ανάμεσα σε δύο κατευθύνσεις σχεδιασμού.
 */
import type { ReactElement } from 'react';

const ICON_PATHS: Record<string, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  sources: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  translations: (
    <path
      d="M4 6h9M4 12h6M13 3l3 3-3 3M20 15l-3 3 3 3M9 21h9"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  screenshots: (
    <path d="M3 4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4Zm2 12 4-4.5 3.2 3 3.8-4.5 5 6H5Zm3-6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
  ),
  tasks: (
    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.7 7.7-5.4 5.4a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 1 1 1.4-1.4l1.9 1.9 4.7-4.7a1 1 0 0 1 1.4 1.4Z" />
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 21c0-4 3-7 6.5-7s6.5 3 6.5 7Z" />
      <circle cx="18" cy="8.5" r="2.6" />
      <path d="M15.5 14c3 .3 5 3.1 5 7h-4.2c0-2.7-.9-5-2.8-6.5.7-.3 1.4-.5 2-.5Z" />
    </>
  ),
  integrations: <path d="M3 3h8v8H3V3Zm10 10h8v8h-8v-8ZM9 11H7v2a4 4 0 0 0 4 4h2v-2h-2a2 2 0 0 1-2-2v-2Z" />,
  qa: (
    <>
      <path
        d="M7 2h7l4.5 4.5V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path
        d="M8.7 12.8l2.3 2.3 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  activity: <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 5v5.4l4 2.3-1 1.7-5-3V7Z" />,
  settings: (
    <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm9.4 2.1-1.6-.5a7.4 7.4 0 0 0-.6-1.5l.8-1.4a1 1 0 0 0-.15-1.2l-1.4-1.4a1 1 0 0 0-1.2-.15l-1.4.8a7.4 7.4 0 0 0-1.5-.6l-.5-1.6a1 1 0 0 0-1-.7h-2a1 1 0 0 0-1 .7l-.5 1.6a7.4 7.4 0 0 0-1.5.6l-1.4-.8a1 1 0 0 0-1.2.15L4.85 5.6a1 1 0 0 0-.15 1.2l.8 1.4a7.4 7.4 0 0 0-.6 1.5l-1.6.5a1 1 0 0 0-.7 1v2a1 1 0 0 0 .7 1l1.6.5c.15.53.35 1.03.6 1.5l-.8 1.4a1 1 0 0 0 .15 1.2l1.4 1.4a1 1 0 0 0 1.2.15l1.4-.8c.47.25.97.45 1.5.6l.5 1.6a1 1 0 0 0 1 .7h2a1 1 0 0 0 1-.7l.5-1.6c.53-.15 1.03-.35 1.5-.6l1.4.8a1 1 0 0 0 1.2-.15l1.4-1.4a1 1 0 0 0 .15-1.2l-.8-1.4c.25-.47.45-.97.6-1.5l1.6-.5a1 1 0 0 0 .7-1v-2a1 1 0 0 0-.7-1Z" />
  ),
};

export function TabIcon({ tabKey }: { tabKey: string }) {
  const path = ICON_PATHS[tabKey];
  if (!path) return null;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {path}
    </svg>
  );
}
