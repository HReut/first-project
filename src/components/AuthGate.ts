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
        <button type="button" class="btn btn--primary auth-card__action" id="auth-action">${opts.actionLabel}</button>
      </div>
    </div>
  `
  const btn = root.querySelector<HTMLButtonElement>('#auth-action')!
  btn.addEventListener('click', () => {
    btn.disabled = true
    signInWithGoogle().catch(() => {
      btn.disabled = false
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
      root.innerHTML = `<p class="view-loading">Checking your session…</p>`
      return
    }
    if (state.kind === 'signed-out') {
      renderAuthScreen(root, {
        title: 'Opa! Tulik',
        message: 'Sign in with your household Google account to see your finances.',
        actionLabel: 'Sign in with Google',
      })
      return
    }
    if (state.kind === 'denied') {
      renderAuthScreen(root, {
        title: 'Access denied',
        message: "This Google account isn't authorized for Opa! Tulik. Try a different account.",
        actionLabel: 'Try a different account',
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
      state = { kind: 'signed-out' }
    } else if (!isEmailAllowed(email)) {
      state = { kind: 'denied' }
      awaitingSignOutEcho = true
      signOut().catch(() => {
        awaitingSignOutEcho = false
      })
    } else {
      state = { kind: 'authenticated', email }
    }
    render()
  })

  render()
}
