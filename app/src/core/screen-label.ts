// The screen's label for this tab (T5). /s/ hands /d/ the label once, in the
// fragment; the entry then drops it from the address so a copied link never
// carries it. Kept in sessionStorage under the room it belongs to, a reload
// of the same tab names the same screen instead of falling back to "zaslon".
// Another room's entry is ignored and replaced; storage that throws is ignored.

export const SCREEN_LABEL_KEY = 'kajima:screen-label:v1';

interface StoredLabel { roomId: string; label: string }

/**
 * The label to use for `roomId`: the one the fragment carries (stored for a
 * reload), else the one this tab stored for the same room, else null.
 */
export function rememberScreenLabel(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, roomId: string, fromHash: string | null): string | null {
  if (fromHash) {
    try { storage?.setItem(SCREEN_LABEL_KEY, JSON.stringify({ roomId, label: fromHash } satisfies StoredLabel)); } catch { /* ignore */ }
    return fromHash;
  }
  try {
    const raw = storage?.getItem(SCREEN_LABEL_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredLabel>;
    return stored.roomId === roomId && typeof stored.label === 'string' && stored.label ? stored.label : null;
  } catch {
    return null;
  }
}
