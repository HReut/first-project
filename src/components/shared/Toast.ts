export interface ToastAction {
  label: string
  onClick: () => void
  primary?: boolean
}

/** Self-dismissing, non-blocking message with optional actions — for
 * nice-to-have prompts (save a mapping rule, a friendly file-type warning)
 * that shouldn't interrupt the user like a Modal would. */
export function showToast(message: string, actions: ToastAction[] = [], durationMs = 8000): void {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.innerHTML = `
    <span>${message}</span>
    ${actions.map((action, index) => `<button type="button" class="btn btn--sm ${action.primary ? 'btn--primary' : ''}" data-action="${index}">${action.label}</button>`).join('')}
  `
  document.body.appendChild(toast)

  const remove = () => toast.remove()
  const timeoutId = window.setTimeout(remove, durationMs)

  toast.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
    if (!button) return
    window.clearTimeout(timeoutId)
    actions[Number(button.dataset.action)]?.onClick()
    remove()
  })
}
