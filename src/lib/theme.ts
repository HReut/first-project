export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'opa-theme'

export function getStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function effectiveTheme(): Theme {
  return getStoredTheme() ?? systemTheme()
}

/** Applies a theme to <html> without persisting it — used for the inline
 * no-FOUC bootstrap in index.html and internally by setTheme(). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/** Persists an explicit theme choice, overriding the OS preference. */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

export function toggleTheme(): Theme {
  const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
