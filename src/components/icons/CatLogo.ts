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
      <circle cx="9.3" cy="13" r="1.15" fill="${eyeFill}" />
      <circle cx="14.7" cy="13" r="1.15" fill="${eyeFill}" />
      <polygon points="11.2,15.6 12.8,15.6 12,16.7" fill="${eyeFill}" />
    </svg>
  `.trim()
}
