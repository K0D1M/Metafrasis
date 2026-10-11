import { el } from '../i18n/el.js';

/** Το σήμα: δύο συννεφάκια διαλόγου, από το λατινικό A στο ελληνικό Ω. */
export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="5" y="7" width="35" height="27" rx="7" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d="M13 34l-3 8 10-8" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
      <text x="22.5" y="27" textAnchor="middle" fontFamily="Noto Sans, system-ui, sans-serif" fontSize="16" fontWeight="700" fill="currentColor">
        A
      </text>
      <rect x="24" y="24" width="36" height="27" rx="7" fill="var(--accent)" stroke="var(--bg)" strokeWidth="3" />
      <path d="M47 51l7 8-1-8z" fill="var(--accent)" />
      <text x="42" y="43.5" textAnchor="middle" fontFamily="'GFS Didot', Georgia, serif" fontSize="18" fill="var(--accent-contrast)">
        Ω
      </text>
    </svg>
  );
}

/** Σήμα και όνομα μαζί, για τον τίτλο των σελίδων. */
export function Logo() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
      <LogoMark />
      <span style={{ fontFamily: "'GFS Didot', Georgia, serif", fontWeight: 400 }}>{el.app.name}</span>
    </span>
  );
}
