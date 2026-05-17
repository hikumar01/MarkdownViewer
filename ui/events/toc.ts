interface TocEntry {
  id: string
  text: string
  level: number
}

const STORAGE_KEY = 'markview-toc'

let observer: IntersectionObserver | null = null
let activeId: string | null = null

function getPanel(): HTMLElement {
  let panel = document.getElementById('toc')
  if (!panel) {
    panel = document.createElement('nav')
    panel.id = 'toc'
    panel.setAttribute('aria-label', 'Table of contents')
    document.getElementById('app')!.appendChild(panel)
  }
  return panel
}

export function isTocVisible(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'closed'
}

function applyVisibility(panel: HTMLElement, visible: boolean): void {
  panel.classList.toggle('toc-visible', visible)
  document.getElementById('app')?.classList.toggle('toc-open', visible)
}

export function toggleToc(): boolean {
  const next = !isTocVisible()
  localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed')
  applyVisibility(getPanel(), next)
  return next
}

export function initToc(): void {
  applyVisibility(getPanel(), isTocVisible())
}

export function clearToc(): void {
  observer?.disconnect()
  observer = null
  activeId = null
  getPanel().innerHTML = ''
}

function buildEntries(container: HTMLElement): TocEntry[] {
  return Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
    .filter(h => h.id)
    .map(h => ({
      id: h.id,
      text: h.textContent?.trim() ?? '',
      level: parseInt(h.tagName[1] ?? '1'),
    }))
}

function setActiveEntry(id: string): void {
  if (id === activeId) return
  activeId = id
  const panel = getPanel()
  for (const item of panel.querySelectorAll<HTMLElement>('.toc-item')) {
    item.classList.toggle('toc-active', item.dataset.id === id)
  }
  panel
    .querySelector<HTMLElement>(`.toc-item[data-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

export function updateToc(container: HTMLElement): void {
  observer?.disconnect()
  observer = null
  activeId = null

  const entries = buildEntries(container)
  const panel = getPanel()
  panel.innerHTML = ''

  if (entries.length === 0) {
    const msg = document.createElement('p')
    msg.className = 'toc-empty'
    msg.textContent = 'No headings found'
    panel.appendChild(msg)
    applyVisibility(panel, isTocVisible())
    return
  }

  const list = document.createElement('ul')
  list.className = 'toc-list'

  for (const entry of entries) {
    const li = document.createElement('li')
    li.className = `toc-item toc-h${entry.level}`
    li.dataset.id = entry.id

    const a = document.createElement('a')
    a.href = `#${entry.id}`
    a.textContent = entry.text
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const target = document.getElementById(entry.id)
      if (!target) return
      const cRect = container.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      container.scrollTo({
        top: container.scrollTop + tRect.top - cRect.top - 16,
        behavior: 'smooth',
      })
    })

    li.appendChild(a)
    list.appendChild(li)
  }

  panel.appendChild(list)
  applyVisibility(panel, isTocVisible())

  // Observe headings relative to the scroll container (#content).
  // rootMargin shrinks the intersection zone to a band near the top of the
  // container so only the heading the user is currently reading is active.
  observer = new IntersectionObserver(
    (observations) => {
      const intersecting = observations
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (intersecting.length > 0) {
        setActiveEntry((intersecting[0]!.target as HTMLElement).id)
      }
    },
    { root: container, rootMargin: '-10% 0px -85% 0px' },
  )

  for (const h of container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (h.id) observer.observe(h)
  }
}
