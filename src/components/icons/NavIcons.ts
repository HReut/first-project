/** Minimal geometric nav icons for the mobile bottom nav — one function per
 * icon, matching the CatLogo.ts convention. All use `currentColor` so CSS
 * drives the active/inactive tint. */

export function homeIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,3 21,10 21,21 3,21 3,10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      <rect x="9.5" y="14" width="5" height="7" fill="currentColor" />
    </svg>
  `.trim()
}

export function listIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="4.5" cy="6" r="1.5" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1.5" fill="currentColor" />
      <rect x="9" y="5" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="9" y="11" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="9" y="17" width="12" height="2" rx="1" fill="currentColor" />
    </svg>
  `.trim()
}

export function chartIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="13" width="4" height="8" rx="1" fill="currentColor" />
      <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" />
      <rect x="16" y="3" width="4" height="18" rx="1" fill="currentColor" />
    </svg>
  `.trim()
}

export function gearIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path
        d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.8 6.2l-1.7 1.7M7.9 16.1l-1.7 1.7M17.8 17.8l-1.7-1.7M7.9 7.9 6.2 6.2"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  `.trim()
}
