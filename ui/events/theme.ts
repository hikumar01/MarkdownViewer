export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'default' | 'dark'

const PREF_KEY = 'markview-theme'

export function getThemePreference(): ThemePreference {
  const v = localStorage.getItem(PREF_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function resolveTheme(pref: ThemePreference): Theme {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'default'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

// Applies `pref`, persists it, and returns the resolved Theme token.
export function applyThemePreference(pref: ThemePreference): Theme {
  const theme = resolveTheme(pref)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(PREF_KEY, pref)
  return theme
}

// Call once at startup. Applies the saved preference, registers an OS-change
// listener that only fires when the preference is 'system', and returns the
// initial resolved Theme so the caller can initialize Mermaid immediately.
export function detectTheme(): Theme {
  const pref = getThemePreference()
  const theme = resolveTheme(pref)
  document.documentElement.classList.toggle('dark', theme === 'dark')

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    // OS changes only affect the app when the user hasn't pinned a manual theme.
    if (getThemePreference() !== 'system') return
    const newTheme = resolveTheme('system')
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
    window.dispatchEvent(new CustomEvent<Theme>('theme-changed', { detail: newTheme }))
  })

  return theme
}
