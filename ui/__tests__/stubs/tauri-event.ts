type Handler<T> = (event: { payload: T }) => void

const handlers = new Map<string, Set<Handler<unknown>>>()

export function listen<T>(event: string, handler: Handler<T>): Promise<() => void> {
  const set = handlers.get(event) ?? new Set()
  set.add(handler as Handler<unknown>)
  handlers.set(event, set)
  return Promise.resolve(() => set.delete(handler as Handler<unknown>))
}

export function __emit<T>(event: string, payload: T): void {
  const set = handlers.get(event)
  if (!set) return
  for (const h of set) (h as Handler<T>)({ payload })
}

export function __resetEvents(): void {
  handlers.clear()
}
