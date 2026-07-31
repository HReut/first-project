/** Minimal geometric shield-cat mark: a rounded shield silhouette whose top
 * edge peaks into two cat ears, with eyes/nose punched out in a second
 * color. Used in the topbar/sidebar badge and as the favicon. */
export function catLogoMarkup(options: { fill?: string; eyeFill?: string } = {}): string {
  // Knockout look: the mark reads as "cut out" of the badge, so its body
  // matches the page background and the eyes/nose show the badge's accent
  // color through — both flip automatically with the light/dark theme vars.
  const fill = options.fill ?? 'var(--bg)'
  const eyeFill = options.eyeFill ?? 'var(--accent)'

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 2 L12 6.5 L18.5 2 L20 9 C20 16 16.5 20 12 22 C7.5 20 4 16 4 9 Z"
        fill="${fill}"
      />
      <ellipse cx="9.3" cy="12" rx="1.3" ry="0.85" fill="${eyeFill}" transform="rotate(-12 9.3 12)" />
      <ellipse cx="14.7" cy="12" rx="1.3" ry="0.85" fill="${eyeFill}" transform="rotate(12 14.7 12)" />
      <path
        d="M7.8 15.2 C9 13.6 10.6 13.8 12 15.4 C13.4 13.8 15 13.6 16.2 15.2 C15 16.8 13.2 16.6 12 15.4 C10.8 16.6 9 16.8 7.8 15.2 Z"
        fill="${eyeFill}"
      />
    </svg>
  `.trim()
}
