import Mark from 'mark.js'

let markInstance: Mark | null = null
let scrollContainer: HTMLElement | null = null
let matches: HTMLElement[] = []
let currentIndex = -1

let panelEl: HTMLElement | null = null
let inputEl: HTMLInputElement | null = null
let countEl: HTMLElement | null = null

function getPanel(): HTMLElement {
  if (!panelEl) {
    panelEl = document.getElementById('search-bar')!
    inputEl  = document.getElementById('search-input') as HTMLInputElement
    countEl  = document.getElementById('search-count')!

    inputEl.addEventListener('input', () => runSearch(inputEl!.value))
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape')                   { e.preventDefault(); closeSearch() }
      else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); prev() }
      else if (e.key === 'Enter')               { e.preventDefault(); next() }
      else if (e.key === 'ArrowDown')           { e.preventDefault(); next() }
      else if (e.key === 'ArrowUp')             { e.preventDefault(); prev() }
    })

    document.getElementById('search-prev')!.addEventListener('click', prev)
    document.getElementById('search-next')!.addEventListener('click', next)
    document.getElementById('search-close')!.addEventListener('click', closeSearch)
  }
  return panelEl!
}

function runSearch(query: string): void {
  if (!markInstance) return
  markInstance.unmark({
    done() {
      matches = []
      currentIndex = -1
      if (!query.trim()) { setCount(0, 0); return }
      markInstance!.mark(query, {
        caseSensitive: false,
        separateWordSearch: false,
        accuracy: 'partially',
        exclude: ['figure.mermaid-diagram *', 'figure.mermaid-broken *'],
        done() {
          matches = Array.from(scrollContainer!.querySelectorAll<HTMLElement>('mark'))
          currentIndex = matches.length > 0 ? 0 : -1
          if (currentIndex >= 0) activate(0)
          setCount(matches.length > 0 ? 1 : 0, matches.length)
        },
      })
    },
  })
}

function activate(idx: number): void {
  matches.forEach(m => m.classList.remove('search-current'))
  const el = matches[idx]
  if (!el) return
  el.classList.add('search-current')
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function next(): void {
  if (!matches.length) return
  currentIndex = (currentIndex + 1) % matches.length
  activate(currentIndex)
  setCount(currentIndex + 1, matches.length)
}

function prev(): void {
  if (!matches.length) return
  currentIndex = (currentIndex - 1 + matches.length) % matches.length
  activate(currentIndex)
  setCount(currentIndex + 1, matches.length)
}

function setCount(current: number, total: number): void {
  if (!countEl) return
  const noMatch = total === 0 && !!inputEl?.value.trim()
  countEl.classList.toggle('search-no-match', noMatch)
  countEl.textContent = noMatch ? 'No matches' : total > 0 ? `${current} of ${total}` : ''
}

function isOpen(): boolean {
  return getPanel().classList.contains('search-open')
}

function closeSearch(): void {
  getPanel().classList.remove('search-open')
  document.getElementById('app')?.classList.remove('search-active')
  markInstance?.unmark()
  matches = []
  currentIndex = -1
  setCount(0, 0)
}

export function openSearch(): void {
  getPanel().classList.add('search-open')
  document.getElementById('app')?.classList.add('search-active')
  inputEl?.focus()
  inputEl?.select()
  if (inputEl?.value.trim()) runSearch(inputEl.value)
}

export function clearSearch(): void {
  if (inputEl) inputEl.value = ''
  closeSearch()
}

export function updateSearchContent(container: HTMLElement): void {
  scrollContainer = container
  markInstance = new Mark(container)
  // Re-highlight if the bar is already open after a file reload
  if (isOpen() && inputEl?.value.trim()) {
    runSearch(inputEl.value)
  }
}

export function initSearch(): void {
  // Keydown fallback — fires when no menu item captures the shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      openSearch()
    }
  }, { capture: true })

  // Click outside the bar closes it
  document.addEventListener('click', (e) => {
    if (isOpen() && !getPanel().contains(e.target as Node)) {
      closeSearch()
    }
  })
}
