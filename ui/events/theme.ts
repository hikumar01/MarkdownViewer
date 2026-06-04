export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'default' | 'dark'

// github-markdown-css ships separate light/dark stylesheets that always apply
// (no media query), so we can drive them off our `html.dark` class instead of
// the OS preference. Both are imported as inline strings at build time and
// swapped into a single <style> element at runtime — using one element keeps
// the cascade unambiguous (no two `.markdown-body` sheets fighting) and
// eliminates any stylesheet load latency on theme change, which previously
// caused a visible flash of unstyled markdown.
import lightCss from 'github-markdown-css/github-markdown-light.css?inline'
import darkCss from 'github-markdown-css/github-markdown-dark.css?inline'
import { getStorageItem, setStorageItem } from './storage'

const PREF_KEY = 'theme'

let markdownStyleEl: HTMLStyleElement | null = null

function applyMarkdownTheme(theme: Theme): void {
  if (!markdownStyleEl) {
    markdownStyleEl = document.createElement('style')
    markdownStyleEl.dataset.markdownTheme = ''
    document.head.appendChild(markdownStyleEl)
  }
  markdownStyleEl.textContent = theme === 'dark' ? darkCss : lightCss
}

export function getThemePreference(): ThemePreference {
  const v = getStorageItem(PREF_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function resolveTheme(pref: ThemePreference): Theme {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'default'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  applyMarkdownTheme(theme)
}

// Applies `pref`, persists it, and returns the resolved Theme token.
export function applyThemePreference(pref: ThemePreference): Theme {
  const theme = resolveTheme(pref)
  applyTheme(theme)
  setStorageItem(PREF_KEY, pref)
  return theme
}

// Call once at startup. Applies the saved preference, registers an OS-change
// listener that only fires when the preference is 'system', and returns the
// initial resolved Theme so the caller can initialize Mermaid immediately.
export function detectTheme(): Theme {
  const pref = getThemePreference()
  // Persist the explicit default so subsequent `getThemePreference` calls
  // (and the inline boot script's lookup) see a concrete value.
  if (getStorageItem(PREF_KEY) === null) {
    setStorageItem(PREF_KEY, pref)
  }
  const theme = resolveTheme(pref)
  applyTheme(theme)

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    // OS changes only affect the app when the user hasn't pinned a manual theme.
    if (getThemePreference() !== 'system') return
    const newTheme = resolveTheme('system')
    applyTheme(newTheme)
    window.dispatchEvent(new CustomEvent<Theme>('theme-changed', { detail: newTheme }))
  })

  return theme
}
