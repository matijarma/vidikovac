// Operational logging. Ported from psdlat worker/src/log.ts. Content rules: an
// event slug, ids and small scalars only. Never a code, a token, a secret, an
// IP address, a user agent or a message body.

/** Reduces an unknown throwable to `Name: message`, with no stack and no properties. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : 'unknown-error';
}

export function logError(
  event: string,
  error: unknown,
  context: Record<string, string | number | boolean | undefined> = {},
): void {
  const parts = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  console.error(`[vidikovac] ${event} ${describeError(error)}${parts.length ? ` ${parts.join(' ')}` : ''}`);
}

export function logInfo(event: string, context: Record<string, string | number | boolean | undefined> = {}): void {
  const parts = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  console.log(`[vidikovac] ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`);
}
