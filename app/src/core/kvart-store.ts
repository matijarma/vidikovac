import { areaName, isAreaSlug, type AreaSlug } from '../../../worker/pairing/areas';
import type { ScreenStop } from '../../../worker/protocol';
import type { I18n } from '../i18n/i18n';

/** What a reader picked in the kvart select: one of the 17 districts, or "follow the screen's stop". */
export type KvartChoice = AreaSlug | 'screen';

export const KVART_STORAGE_KEY = 'kajima:kvart:v1';

export interface KvartStore {
  snapshot(): KvartChoice;
  set(choice: KvartChoice): void;
  subscribe(listener: (choice: KvartChoice) => void): () => void;
}

export interface KvartStoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function isKvartChoice(value: unknown): value is KvartChoice {
  return value === 'screen' || isAreaSlug(value);
}

function readStored(storage: Pick<Storage, 'getItem'> | null | undefined): KvartChoice {
  if (!storage) return 'screen';
  try {
    const raw = storage.getItem(KVART_STORAGE_KEY);
    return isKvartChoice(raw) ? raw : 'screen';
  } catch {
    return 'screen';
  }
}

/** Stores the *choice*, not the resolved district (`resolveKvart` does that), so a new
 *  session with another screen re-resolves "screen" against the new stop instead of
 *  replaying a stale district from a previous visit. */
export function createKvartStore(deps: KvartStoreDeps): KvartStore {
  const storage = deps.storage ?? null;
  let choice: KvartChoice = readStored(storage);
  const listeners = new Set<(choice: KvartChoice) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(choice);
  };
  return {
    snapshot: () => choice,
    set(next) {
      if (!isKvartChoice(next)) return;
      choice = next;
      try {
        storage?.setItem(KVART_STORAGE_KEY, next);
      } catch {
        // Private mode or a full quota: the choice still holds for this tab.
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(choice);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 'screen' follows the session's stop; without a screen or a district it is null (the whole
 * city). `stop` is typed as the worker's `ScreenStop`; `district` is read defensively because
 * it lands on that interface additively in T2.1 (D6) and is not guaranteed present here yet.
 */
export function resolveKvart(choice: KvartChoice, stop: ScreenStop | undefined): AreaSlug | null {
  if (choice !== 'screen') return choice;
  const district = (stop as (ScreenStop & { district?: string }) | undefined)?.district;
  return district !== undefined && isAreaSlug(district) ? district : null;
}

/** The district's name, or "Cijeli grad" for the whole city. */
export function kvartLabel(i18n: I18n, resolved: AreaSlug | null): string {
  return resolved ? areaName(resolved) : i18n.t('kvart.wholeCity');
}
