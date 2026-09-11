import type { Env } from '../env';

// Area B replaces this stub with HMAC-SHA256 data tokens, tickets and ids.
// Signature is the cross-area contract consumed by Area A (/api/data).
export async function verifyDataToken(
  _env: Env,
  _token: string,
): Promise<{ roomId: string; expiresAt: number } | null> {
  return null;
}
