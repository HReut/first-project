/** Minimal reusable modal: backdrop, Esc-to-close, click-outside-to-close.
 * Callers get the inner `.modal` element back to wire up their own form/content. */
export class Modal {
  #backdrop: HTMLDivElement
  #onClose?: () => void

  constructor(contentHtml: string, options: { onClose?: () => void; ariaLabel?: string } = {}) {
    this.#onClose = options.onClose

    this.#backdrop = document.createElement('div')
    this.#backdrop.className = 'modal-backdrop'
    this.#backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true"${options.ariaLabel ? ` aria-label="${options.ariaLabel}"` : ''}>
        ${contentHtml}
      </div>
    `
    this.#backdrop.addEventListener('click', (event) => {
      if (event.target === this.#backdrop) this.close()
    })
    document.addEventListener('keydown', this.#handleKeydown)
    document.body.appendChild(this.#backdrop)
  }

  #handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close()
  }

  get element(): HTMLElement {
    return this.#backdrop.querySelector<HTMLElement>('.modal')!
  }

  close(): void {
    document.removeEventListener('keydown', this.#handleKeydown)
    this.#backdrop.remove()
    this.#onClose?.()
  }
}
