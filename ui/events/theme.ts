export type Theme = 'default' | 'dark'

export function detectTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')

  document.documentElement.classList.toggle('dark', mq.matches)

  mq.addEventListener('change', (e) => {
    const theme: Theme = e.matches ? 'dark' : 'default'
    document.documentElement.classList.toggle('dark', e.matches)
    window.dispatchEvent(new CustomEvent<Theme>('theme-changed', { detail: theme }))
  })
}
