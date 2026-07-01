// Main-thread client for the render worker. Exposes the same `renderMarkdown`
// signature the app already used, but dispatches the work to renderWorker.ts and
// awaits the result — keeping the UI responsive on large documents.
//
// Robustness: if the environment has no `Worker` (e.g. a non-browser test
// runner) or the worker fails to construct or errors at runtime, the client
// transparently falls back to running the pipeline synchronously on the calling
// thread. Rendering therefore always succeeds; the worker is a performance
// optimization, not a correctness dependency.

import { getEnabledBundles } from '../settings'
import type { RenderRequest, RenderResponse } from './renderWorker'

type Pending = { resolve: (html: string) => void; reject: (err: Error) => void }

let worker: Worker | null = null
let workerUnavailable = false
let seq = 0
const pending = new Map<number, Pending>()

function rejectAll(err: Error): void {
  for (const { reject } of pending.values()) reject(err)
  pending.clear()
}

function getWorker(): Worker | null {
  if (worker) return worker
  if (workerUnavailable || typeof Worker === 'undefined') return null

  try {
    const w = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<RenderResponse>): void => {
      const { id, html, error } = ev.data
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (error !== undefined) entry.reject(new Error(error))
      else entry.resolve(html ?? '')
    }
    w.onerror = (): void => {
      // The worker died — abandon it, fail in-flight requests, and let future
      // calls fall back to synchronous rendering.
      workerUnavailable = true
      worker = null
      rejectAll(new Error('render worker error'))
    }
    worker = w
    return w
  } catch {
    workerUnavailable = true
    return null
  }
}

async function renderInline(content: string, basePath: string, bundles: RenderRequest['bundles']): Promise<string> {
  const { renderMarkdown } = await import('./pipeline')
  return renderMarkdown(content, basePath, bundles)
}

export async function renderMarkdown(content: string, basePath: string): Promise<string> {
  const bundles = getEnabledBundles()
  const w = getWorker()
  if (!w) return renderInline(content, basePath, bundles)

  const id = ++seq
  try {
    return await new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ id, content, basePath, bundles } satisfies RenderRequest)
    })
  } catch {
    // Worker-path failure (e.g. onerror) — retry once synchronously so a render
    // is never lost.
    pending.delete(id)
    return renderInline(content, basePath, bundles)
  }
}
