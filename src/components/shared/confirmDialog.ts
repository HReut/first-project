import { Modal } from './Modal.ts'

/** A yes/no modal for actions worth double-checking before doing (deleting
 * things). Resolves true only if the confirm button was clicked — closing
 * any other way (Cancel, Escape, clicking outside) resolves false. */
export function confirmDialog(message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(
      `
        <h2 class="modal__title">Are you sure?</h2>
        <p class="import-preview__hint">${message}</p>
        <div class="modal__actions">
          <button type="button" class="btn" id="confirm-dialog-cancel">Cancel</button>
          <button type="button" class="btn btn--danger" id="confirm-dialog-ok">${confirmLabel}</button>
        </div>
      `,
      { ariaLabel: 'Confirm', onClose: () => resolve(false) },
    )

    modal.element.querySelector<HTMLButtonElement>('#confirm-dialog-cancel')!.addEventListener('click', () => modal.close())
    modal.element.querySelector<HTMLButtonElement>('#confirm-dialog-ok')!.addEventListener('click', () => {
      resolve(true)
      modal.close()
    })
  })
}
