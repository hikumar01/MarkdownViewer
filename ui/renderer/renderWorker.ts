// Dedicated Web Worker that runs the (CPU-heavy) unified render pipeline off the
// UI thread, so large documents and Shiki's WASM highlighter never block
// scrolling, typing in Find, or menu interaction. The main thread talks to this
// worker through renderClient.ts, which correlates requests/responses by id and
// transparently falls back to synchronous rendering when workers are unavailable.

import { renderMarkdown } from './pipeline'
import type { BundleId } from './bundles'

export interface RenderRequest {
  id: number
  content: string
  basePath: string
  bundles: BundleId[]
}

export interface RenderResponse {
  id: number
  html?: string
  error?: string
}

// Minimal structural typing of the worker global. We avoid pulling in the
// "webworker" TS lib because it conflicts with the "DOM" lib the rest of the
// app is compiled against (both declare `self`, `postMessage`, etc.).
interface WorkerScope {
  onmessage: ((ev: MessageEvent<RenderRequest>) => void) | null
  postMessage(message: RenderResponse): void
}

const ctx = self as unknown as WorkerScope

ctx.onmessage = async (ev): Promise<void> => {
  const { id, content, basePath, bundles } = ev.data
  try {
    const html = await renderMarkdown(content, basePath, bundles)
    ctx.postMessage({ id, html })
  } catch (err) {
    ctx.postMessage({ id, error: String(err) })
  }
}
