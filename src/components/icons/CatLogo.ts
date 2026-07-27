/** Minimal geometric cat-head mark: two triangle ears + a circle head, with
 * eyes/nose punched out in a second color. Used in the topbar badge and as
 * the favicon. */
export function catLogoMarkup(options: { fill?: string; eyeFill?: string } = {}): string {
  const fill = options.fill ?? '#ffffff'
  const eyeFill = options.eyeFill ?? 'currentColor'

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="3,8 10,8 5,1" fill="${fill}" />
      <polygon points="21,8 14,8 19,1" fill="${fill}" />
      <circle cx="12" cy="14" r="8" fill="${fill}" />
      <circle cx="9" cy="13" r="1.3" fill="${eyeFill}" />
      <circle cx="15" cy="13" r="1.3" fill="${eyeFill}" />
      <polygon points="11.3,16.4 12.7,16.4 12,17.5" fill="${eyeFill}" />
    </svg>
  `.trim()
}
