import { isEmailAllowed, onAuthChange, signInWithGoogle, signOut } from '../lib/auth.ts'
import { catLogoMarkup } from './icons/CatLogo.ts'
import { mountApp } from './App.ts'

type GateState = { kind: 'checking' } | { kind: 'signed-out' } | { kind: 'denied' } | { kind: 'authenticated'; email: string }

function renderAuthScreen(root: HTMLElement, opts: { title: string; message: string; actionLabel: string; danger?: boolean }): void {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <span class="auth-card__mark" aria-hidden="true">${catLogoMarkup()}</span>
        <h1 class="auth-card__title">${opts.title}</h1>
        <p class="auth-card__message">${opts.message}</p>
        <button type="button" class="btn btn--primary auth-card__action" id="auth-action">
          <span class="auth-card__spinner" aria-hidden="true"></span>
          <span class="auth-card__action-label">${opts.actionLabel}</span>
        </button>
        <p class="auth-card__error" id="auth-error" role="alert" hidden></p>
      </div>
    </div>
  `
  const btn = root.querySelector<HTMLButtonElement>('#auth-action')!
  const label = root.querySelector<HTMLElement>('.auth-card__action-label')!
  const errorEl = root.querySelector<HTMLElement>('#auth-error')!
  btn.addEventListener('click', () => {
    btn.disabled = true
    btn.classList.add('is-loading')
    label.textContent = 'מתחבר…'
    errorEl.hidden = true
    signInWithGoogle().catch(() => {
      btn.disabled = false
      btn.classList.remove('is-loading')
      label.textContent = opts.actionLabel
      errorEl.textContent = 'ההתחברות נכשלה — נסה/י שוב.'
      errorEl.hidden = false
    })
  })
  if (opts.danger) root.querySelector('.auth-card')?.classList.add('auth-card--danger')
}

export function mountAuthGate(root: HTMLElement): void {
  let state: GateState = { kind: 'checking' }
  // Signing out a denied user triggers another onAuthChange(null) — swallow
  // that echo so the "Access denied" screen doesn't get overwritten by the
  // plain sign-in screen before the user has read it.
  let awaitingSignOutEcho = false

  function render(): void {
    if (state.kind === 'checking') {
      root.innerHTML = `<p class="view-loading">בודק את החיבור שלך…</p>`
      return
    }
    if (state.kind === 'signed-out') {
      renderAuthScreen(root, {
        title: 'Opa! Tulik',
        message: 'התחבר/י עם חשבון הגוגל של משק הבית כדי לראות את הכספים שלך.',
        actionLabel: 'התחברות עם Google',
      })
      return
    }
    if (state.kind === 'denied') {
      renderAuthScreen(root, {
        title: 'הגישה נדחתה',
        message: 'חשבון הגוגל הזה אינו מורשה עבור Opa! Tulik. נסה/י חשבון אחר.',
        actionLabel: 'נסה/י חשבון אחר',
        danger: true,
      })
      return
    }
    mountApp(root, state.email)
  }

  onAuthChange((email) => {
    if (!email) {
      if (awaitingSignOutEcho) {
        awaitingSignOutEcho = false
        return
      }
      if (state.kind === 'signed-out') return
      state = { kind: 'signed-out' }
    } else if (!isEmailAllowed(email)) {
      if (state.kind === 'denied') return
      state = { kind: 'denied' }
      awaitingSignOutEcho = true
      signOut().catch(() => {
        awaitingSignOutEcho = false
      })
    } else {
      // Supabase re-fires this on routine token refreshes — e.g. switching
      // back to this browser tab — not just on an actual new sign-in. Skip
      // re-rendering (which would remount the whole app and blow away any
      // unsaved form input) when it's the same person already signed in.
      if (state.kind === 'authenticated' && state.email === email) return
      state = { kind: 'authenticated', email }
    }
    render()
  })

  render()
}
