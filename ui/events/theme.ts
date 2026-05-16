export function detectTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')

  document.documentElement.classList.toggle('dark', mq.matches)

  mq.addEventListener('change', (e) => {
    document.documentElement.classList.toggle('dark', e.matches)
  })
}
