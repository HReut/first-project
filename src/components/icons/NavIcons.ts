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

export function targetIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  `.trim()
}

export function coinsIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6.6" rx="7" ry="2.4" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path d="M5 6.6v4.6c0 1.3 3.1 2.4 7 2.4s7-1.1 7-2.4V6.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      <path d="M5 11.2v4.6c0 1.3 3.1 2.4 7 2.4s7-1.1 7-2.4v-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>
  `.trim()
}

export function walletIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path d="M3 9.5h18" stroke="currentColor" stroke-width="1.7" />
      <circle cx="16.3" cy="14" r="1.3" fill="currentColor" />
    </svg>
  `.trim()
}

export function shieldCheckIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.2 19 6v5.2c0 5-3 8.4-7 9.6-4-1.2-7-4.6-7-9.6V6Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
      <path d="M8.7 12 11 14.3l4.3-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `.trim()
}

export function searchIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.8" />
      <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  `.trim()
}

export function bellIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 10.5a6 6 0 0 1 12 0v3.8l1.4 2.3H4.6L6 14.3Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
      <path d="M9.8 19a2.3 2.3 0 0 0 4.4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>
  `.trim()
}

export function plusIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `.trim()
}

export function refreshIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5M19.5 12a7.5 7.5 0 0 1-12.6 5.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
      <path d="M17.5 3.5v3.5H14M6.5 20.5V17H10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `.trim()
}

export function uploadIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V4M8 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  `.trim()
}

export function downloadIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11M8 11l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  `.trim()
}

export function columnsIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path d="M9.5 4.5v15M14.5 4.5v15" stroke="currentColor" stroke-width="1.7" />
    </svg>
  `.trim()
}

export function filterIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16L14 13v5.5l-4 2V13Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
    </svg>
  `.trim()
}

export function historyIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20a8 8 0 1 0-6.7-3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M2.5 14v3.5H6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `.trim()
}

export function calendarIconMarkup(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>
  `.trim()
}
