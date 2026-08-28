/** Minimal reusable modal: backdrop, Esc-to-close, click-outside-to-close.
 * Callers get the inner `.modal` element back to wire up their own form/content. */
export class Modal {
  #backdrop: HTMLDivElement
  #onClose?: () => void
  #onBeforeClose?: () => boolean | Promise<boolean>

  constructor(
    contentHtml: string,
    options: { onClose?: () => void; ariaLabel?: string; onBeforeClose?: () => boolean | Promise<boolean> } = {},
  ) {
    this.#onClose = options.onClose
    this.#onBeforeClose = options.onBeforeClose

    this.#backdrop = document.createElement('div')
    this.#backdrop.className = 'modal-backdrop'
    this.#backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true"${options.ariaLabel ? ` aria-label="${options.ariaLabel}"` : ''}>
        <button type="button" class="modal__close" aria-label="סגירה">✕</button>
        ${contentHtml}
      </div>
    `
    this.#backdrop.addEventListener('click', (event) => {
      if (event.target === this.#backdrop) void this.requestClose()
    })
    this.#backdrop.querySelector<HTMLButtonElement>('.modal__close')!.addEventListener('click', () => void this.requestClose())
    document.addEventListener('keydown', this.#handleKeydown)
    document.body.appendChild(this.#backdrop)
  }

  #handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') void this.requestClose()
  }

  get element(): HTMLElement {
    return this.#backdrop.querySelector<HTMLElement>('.modal')!
  }

  /** Closing via Escape/backdrop/✕ — runs the onBeforeClose guard first
   * (e.g. "you have unsaved edits, leave anyway?"), so those exits can't
   * silently drop staged changes the way a plain close() would. */
  async requestClose(): Promise<void> {
    if (this.#onBeforeClose && !(await this.#onBeforeClose())) return
    this.close()
  }

  /** Unconditional close, no guard — for callers that already know it's
   * safe (e.g. right after a successful save, or a modal with no
   * unsaved-changes concern). */
  close(): void {
    document.removeEventListener('keydown', this.#handleKeydown)
    this.#backdrop.remove()
    this.#onClose?.()
  }
}
