// Shared browser-test helpers (R-39): one FakeSocket, one flush, one text for
// every test under test/app. Not a *.test.ts file, so the unit project does not
// collect it as a suite.
import type { WebSocketLike } from '../../app/src/session';

/** A WebSocket the test drives by hand: nothing happens until the test says so. */
export class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  /** Set by close(); `closedWith` is the bare code for tests that only check that. */
  closed: { code?: number } | null = null;
  closedWith: number | null = null;
  private readonly handlers: Record<string, ((event: never) => void)[]> = {};

  constructor(public readonly url: string) {}

  addEventListener(type: string, listener: (event: never) => void): void {
    (this.handlers[type] ??= []).push(listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closed = { code };
    this.closedWith = code ?? 1000;
    this.emit('close', { code: code ?? 1000, reason: '' });
  }
  /** Dispatches one event to whatever the client registered. */
  emit(type: string, event: unknown = {}): void {
    if (type === 'open') this.readyState = 1;
    if (type === 'close') this.readyState = 3;
    for (const listener of this.handlers[type] ?? []) listener(event as never);
  }
  /** Delivers one server frame as JSON text. */
  server(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
  /** The i-th outbound frame, parsed. */
  json(index: number): unknown {
    return JSON.parse(this.sent[index]!);
  }
}

/** Drains the microtask queue: enough for a handler that awaits a chain of promises. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** Visible text of an element, whitespace collapsed; '' when the element is absent. */
export const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
