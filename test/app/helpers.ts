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

/**
 * Replaces `globalThis.localStorage` with a working in-memory Storage.
 *
 * Node ships a `localStorage` global of its own (stable without a flag since
 * Node 22, present in this project's Node 25). Vitest's `happy-dom`
 * environment never overwrites a global that already exists under that name,
 * so happy-dom's real, Storage-backed `window.localStorage` never reaches
 * `globalThis` — every `@vitest-environment happy-dom` test is left with
 * Node's own placeholder, which has no backing file (`--localstorage-file`)
 * and therefore no working `getItem`/`setItem`/`clear` at all. Call this once
 * per file (module scope is enough; the same shim instance survives between
 * tests, so a plain `localStorage.clear()` in `beforeEach` is all that is
 * needed after that) before any code — test or app — touches the bare
 * `localStorage` identifier. Not a vitest/Node bug this project owns fixing
 * upstream; only a shim so the tests we write can rely on the browser API
 * they are named after.
 */
export function stubLocalStorage(): void {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
}

/**
 * Pins `navigator.language`/`navigator.languages` to a tag outside our
 * catalog (`de-DE` by default). happy-dom's default navigator reports
 * `en-US`, so with no stored locale `bootLocale()`'s browser-language
 * fallback would resolve to English before ever reaching the Croatian
 * `DEFAULT_LOCALE` — silently defeating any `bootPage` test that expects the
 * Croatian-with-nothing-stored baseline. Call once per file; it does not
 * need to be repeated in `beforeEach`.
 */
export function stubNavigatorLanguage(tags: readonly string[] = ['de-DE']): void {
  Object.defineProperty(navigator, 'language', { value: tags[0] ?? '', configurable: true });
  Object.defineProperty(navigator, 'languages', { value: [...tags], configurable: true });
}
