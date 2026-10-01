// The short origin line is used by Još without loading the optional session sheet.
import type { Role } from '../../../worker/protocol';
import type { I18n } from '../i18n/i18n';

export interface SessionOrigin {
  role: Role | null;
  label: string | null;
  stop: string | null;
}

export function originSentence(i18n: I18n, origin: SessionOrigin, short = false): string {
  if (!origin.role) return '';
  if (origin.role === 'phone') return i18n.t('session.sheetPeer');
  const { label, stop } = origin;
  if (label && stop && !short) return i18n.t('session.sheetScreen', { label, stop });
  if (label) return i18n.t('session.sheetScreenOnly', { label });
  if (stop) return i18n.t('session.sheetStop', { stop });
  return i18n.t('session.sheetScreenNearby');
}
