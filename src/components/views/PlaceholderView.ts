/** Generic "coming soon" page for nav destinations that exist in the design
 * but aren't wired up to real data/features yet. */
export function mountPlaceholderView(root: HTMLElement, opts: { eyebrow: string; title: string; subtitle: string; icon: string }): void {
  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">${opts.eyebrow}</p>
        <h1>${opts.title}.</h1>
        <p class="hero__subtitle">${opts.subtitle}</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="placeholder-card">
          <span class="placeholder-card__icon" aria-hidden="true">${opts.icon}</span>
          <h2 class="placeholder-card__title">Coming soon</h2>
          <p class="placeholder-card__body">This page isn't built yet — it's here so the navigation matches the full design. Ask for it when you're ready to wire it up.</p>
        </div>
      </div>
    </section>
  `
}
