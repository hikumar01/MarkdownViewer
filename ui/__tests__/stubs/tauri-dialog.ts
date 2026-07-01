let confirmResult = true
let messageCalls: Array<{ msg: string; opts?: unknown }> = []
let confirmCalls: Array<{ msg: string; opts?: unknown }> = []

export function __setConfirmResult(v: boolean): void { confirmResult = v }
export function __resetDialog(): void {
  confirmResult = true
  messageCalls = []
  confirmCalls = []
}
export function __getConfirmCalls() { return confirmCalls }
export function __getMessageCalls() { return messageCalls }

export function confirm(message: string, opts?: unknown): Promise<boolean> {
  confirmCalls.push({ msg: message, opts })
  return Promise.resolve(confirmResult)
}

export function message(msg: string, opts?: unknown): Promise<void> {
  messageCalls.push({ msg, opts })
  return Promise.resolve()
}
