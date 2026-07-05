// Wraps every rendered <img> so load/error states can be styled, and swaps a
// broken image for a placeholder. Extracted from main.ts to keep image DOM
// concerns out of the file-loading orchestration.

export function attachImageHandlers(container: HTMLElement): void {
  for (const img of container.querySelectorAll<HTMLImageElement>('img')) {
    const wrapper = document.createElement('div')
    wrapper.className = 'img-wrapper img-loading'
    img.parentNode!.insertBefore(wrapper, img)
    wrapper.appendChild(img)

    const onLoad = (): void => wrapper.classList.remove('img-loading')
    const onError = (): void => {
      const broken = document.createElement('div')
      broken.className = 'img-broken'
      broken.title = img.src
      wrapper.replaceWith(broken)
    }

    if (img.complete) {
      img.naturalWidth > 0 ? onLoad() : onError()
    } else {
      img.addEventListener('load', onLoad, { once: true })
      img.addEventListener('error', onError, { once: true })
    }
  }
}
