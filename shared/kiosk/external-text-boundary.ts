import type { ExternalTextKind, ExternalTextSurface } from './external-text';

type Boundary = (kind: ExternalTextKind, value: unknown, surface: ExternalTextSurface) => string | null;
let boundary: Boundary | null = null;

/** Shared renderers are also in the phone's lightweight graph. They never
 * pull the wall policy into that graph, and NEVER render unchecked text while
 * waiting for it. The kiosk and lazy map entry modules load it explicitly. */
export const vetExternal: Boundary = (kind, value, surface) => boundary?.(kind, value, surface) ?? null;
export function installExternalTextBoundary(check: Boundary): void { boundary = check; }
