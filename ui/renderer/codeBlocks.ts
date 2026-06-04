export function attachCopyButtons(container: HTMLElement): void {
  for (const pre of container.querySelectorAll<HTMLElement>('pre.shiki')) {
    const code = pre.querySelector('code')
    if (!code) continue

    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.textContent = 'Copy'
    btn.setAttribute('aria-label', 'Copy code to clipboard')

    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent ?? '').then(() => {
        btn.textContent = 'Copied!'
        btn.classList.add('copy-btn-success')
        setTimeout(() => {
          btn.textContent = 'Copy'
          btn.classList.remove('copy-btn-success')
        }, 1500)
      }).catch(() => {})
    })

    pre.appendChild(btn)
  }
}
