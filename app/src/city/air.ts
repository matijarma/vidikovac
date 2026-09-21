import type { I18n } from '../i18n/i18n';
import { ct } from './strings';
/** The six source-provided station index classes, not a citywide verdict. */
export function airIndexLabel(i18n: Pick<I18n,'getLocale'>, index: unknown): string {
  const labels=i18n.getLocale().startsWith('en')?['Good','Fair','Moderate','Poor','Very poor','Extremely poor']:['Dobra','Prihvatljiva','Umjerena','Loša','Vrlo loša','Izrazito loša'];
  return typeof index==='number'&&Number.isInteger(index)?labels[index-1]??ct(i18n,'unknown'):ct(i18n,'unknown');
}
