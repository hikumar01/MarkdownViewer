// P1 Feature 1 replaces this with Tauri's theme API (appWindow.onThemeChanged)
// for proper OS sync — this is a P0 stub using the browser matchMedia API.
export function detectTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')

  if (mq.matches) {
    document.documentElement.classList.add('dark')
  }

  mq.onchange = (e) => {
    if (e.matches) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }
}
