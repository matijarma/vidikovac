// Real file download — the direct fix for v1's file-download bug (see
// task-m4.4-brief.md): v1 opened received files with `target="_blank"`,
// which just navigates to (or inline-previews) the blob instead of saving
// it, and never carried the ORIGINAL filename. This module NEVER does that:
// the anchor path always sets `download="<originalName>"` and is never
// given a `target`. On Chromium desktop, large files prefer
// `showSaveFilePicker()` (feature-detected) so the browser streams straight
// to disk instead of buffering the whole blob in memory first.
//
// Every browser global is injectable (same discipline as
// receive-surfacing.ts / theme.ts) so this is deterministically unit
// testable under jsdom/happy-dom, which implement neither
// `showSaveFilePicker` nor a real download navigation.

/** Structural subset of `FileSystemFileHandle` this module needs. */
export interface FileSystemWritableLike extends Pick<WritableStream, 'getWriter'> {
  write(chunk: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

export interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableLike>;
}

export type ShowSaveFilePickerLike = (options?: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandleLike>;

/** Minimal `document` surface this module needs to build + click a
 *  throwaway anchor. */
export interface DownloadDocumentLike {
  createElement(tag: 'a'): HTMLAnchorElement;
  body: { appendChild(node: Node): Node; removeChild(node: Node): Node };
}

export interface DownloadFileDeps {
  document?: DownloadDocumentLike;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  /** Feature-detected `window.showSaveFilePicker`. Undefined/omitted on
   *  browsers that don't support it (Firefox, Safari, mobile Chromium) —
   *  the anchor-download path is used instead. */
  showSaveFilePicker?: ShowSaveFilePickerLike;
  /** Byte size at/above which `showSaveFilePicker` (when available) is
   *  preferred over the anchor-download so the browser streams to disk
   *  rather than holding the whole Blob in memory. Default 64 MiB. */
  largeFileThresholdBytes?: number;
  /** How long to wait before revoking the created object URL (ms) — gives
   *  the browser time to actually start the download before the blob: URL
   *  is invalidated. Default 30_000. Set to 0 in tests. */
  revokeDelayMs?: number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  /**
   * Platform save handler, tried BEFORE any browser path. Supplied only by the
   * Android shell (M7).
   *
   * Necessary because the anchor path does not merely degrade in an Android
   * WebView — it fails SILENTLY. A WebView has no download manager, and a
   * programmatic click on a `blob:` URL is dropped on the floor unless the host
   * app installs a `DownloadListener`; Capacitor installs none (verified: its
   * Android package contains no `DownloadListener` and no `blob:` handling at
   * all). So without this, receiving a file appeared to work and saved nothing.
   *
   * Resolving `false` means "not handled, fall through to the browser paths"
   * rather than "failed", so a shell whose bridge is unavailable still gets the
   * normal behaviour. Rejecting propagates as a real failure.
   */
  nativeSave?: (file: File) => Promise<boolean>;
}

export type DownloadOutcome = 'anchor' | 'picker' | 'canceled' | 'native';

export const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 64 * 1024 * 1024; // 64 MiB

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Saves `file` to disk with its ORIGINAL filename.
 *
 * - Small/default: an `<a download="<name>">` object-URL click — never
 *   `target="_blank"` (the v1 bug: that just navigates/previews instead of
 *   saving, and drops the real filename).
 * - Large files on a browser that supports `showSaveFilePicker` (Chromium
 *   desktop): streams `file.stream()` straight to the user-chosen location
 *   instead of materializing the whole Blob via the anchor path. A
 *   deliberate user cancel (`AbortError`) resolves `'canceled'` — it does
 *   NOT fall back to the anchor path (the user said no, not "try again").
 *   Any OTHER picker failure falls back to the anchor path.
 */
export async function downloadFile(
  file: File,
  deps: DownloadFileDeps = {},
): Promise<DownloadOutcome> {
  const threshold = deps.largeFileThresholdBytes ?? DEFAULT_LARGE_FILE_THRESHOLD_BYTES;
  const picker = deps.showSaveFilePicker;

  // First, because on Android every browser path below is a silent no-op. A
  // `false` result means "not handled here" and falls through deliberately.
  if (deps.nativeSave && (await deps.nativeSave(file))) {
    return 'native';
  }

  if (picker && file.size >= threshold) {
    try {
      const handle = await picker({ suggestedName: file.name });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      return 'picker';
    } catch (err) {
      if (isAbortError(err)) return 'canceled'; // user explicitly canceled the save dialog
      // Any other picker failure (unsupported at runtime, I/O error, …) —
      // fall back to the anchor path rather than losing the download.
    }
  }

  anchorDownload(file, deps);
  return 'anchor';
}

function anchorDownload(file: File, deps: DownloadFileDeps): void {
  const doc = deps.document ?? (document as unknown as DownloadDocumentLike);
  const createUrl = deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
  const scheduleTimeout = deps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const revokeDelayMs = deps.revokeDelayMs ?? 30_000;

  const url = createUrl(file);
  const anchor = doc.createElement('a');
  anchor.href = url;
  // ORIGINAL filename — the v1 bug fix. NEVER set `anchor.target` here (v1's
  // exact anti-pattern: `target="_blank"` opens/previews instead of saving).
  anchor.download = file.name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  anchor.click();
  doc.body.removeChild(anchor);
  scheduleTimeout(() => revokeUrl(url), revokeDelayMs);
}
