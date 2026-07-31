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
      <ellipse cx="9.2" cy="11.8" rx="1.7" ry="1.15" fill="${eyeFill}" transform="rotate(-15 9.2 11.8)" />
      <ellipse cx="14.8" cy="11.8" rx="1.7" ry="1.15" fill="${eyeFill}" transform="rotate(15 14.8 11.8)" />
      <path
        d="M6.8 15.6 C8.5 13 11 13.3 12 16 C13 13.3 15.5 13 17.2 15.6 C15.5 18.2 13 18 12 16 C11 18 8.5 18.2 6.8 15.6 Z"
        fill="${eyeFill}"
      />
    </svg>
  `.trim()
}
