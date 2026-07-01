// Minimal stub for @tauri-apps/api/core. Tests that need to assert specific
// invoke calls can override calls via __setInvokeImpl.
type InvokeImpl = (cmd: string, args?: Record<string, unknown>) => unknown

let impl: InvokeImpl = () => undefined
export const __invokeCalls: Array<{ cmd: string; args?: Record<string, unknown> }> = []

export function __setInvokeImpl(fn: InvokeImpl): void {
  impl = fn
}

export function __resetInvoke(): void {
  impl = () => undefined
  __invokeCalls.length = 0
}

export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  __invokeCalls.push({ cmd, args })
  return Promise.resolve(impl(cmd, args) as T)
}
