// Shared markup for every domain workspace: section heads, rows, chips,
// action buttons and the list/detail shell. Interactions are declared as
// `data-action` attributes and handled by delegation on the workspace root,
// so the reconciler can keep nodes without keeping stale closures.
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { publicItemKey, type PublicSelection } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { statusBadge } from './status';

export type Tone = 'action' | 'weather' | 'events' | 'urgency' | 'transit' | 'civic' | 'neutral';

export function attrs(values: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeAttribute(String(v))}"`))
    .join(' ');
}

function dataAttrs(extra: Record<string, string | number | undefined> | undefined): Record<string, string | number | undefined> {
  return Object.fromEntries(Object.entries(extra ?? {}).map(([k, v]) => [`data-${k}`, v]));
}

export interface SectionHeadOptions {
  kicker?: string;
  title: string;
  snapshot?: ModuleSnapshot;
  error?: string;
  level?: 2 | 3;
  id?: string;
  aside?: string;
  noStatus?: boolean;
}

/** Head of a workspace section: quiet kicker, title, live status word. */
export function sectionHead(i18n: I18n, o: SectionHeadOptions): string {
  const level = o.level ?? 2;
  const id = o.id ? ` id="${escapeAttribute(o.id)}"` : '';
  const status = o.noStatus ? '' : statusBadge(i18n, o.snapshot, o.error);
  return `<header class="sec-head">${o.kicker ? `<p class="kicker">${escapeHtml(o.kicker)}</p>` : ''}<div class="sec-title-row"><h${level} class="sec-title"${id}>${escapeHtml(o.title)}</h${level}>${status}${o.aside ?? ''}</div></header>`;
}

export interface SectionOptions {
  id: string;
  tone?: Tone;
  className?: string;
  body: string;
  testid?: string;
  /** Further attributes on the section (e.g. data-level). */
  extra?: Record<string, string>;
}

export function section(o: SectionOptions): string {
  const testid = o.testid ? ` data-testid="${escapeAttribute(o.testid)}"` : '';
  const extra = o.extra ? ` ${attrs(o.extra)}` : '';
  return `<section class="sec ${o.className ?? ''}" id="${escapeAttribute(o.id)}" data-key="${escapeAttribute(o.id)}" data-tone="${o.tone ?? 'neutral'}"${testid}${extra} aria-labelledby="${escapeAttribute(o.id)}-title">${o.body}</section>`;
}

export function iconText(icon: IconName, label: string, className = ''): string {
  return `<span class="icon-text ${className}">${iconMarkup(icon)}<span>${escapeHtml(label)}</span></span>`;
}

export interface ActionButtonOptions {
  icon?: IconName;
  className?: string;
  extra?: Record<string, string | number | undefined>;
  pressed?: boolean;
  id?: string;
  title?: string;
}

/** A control declared as data-action; `extra` are further data attributes. */
export function actionButton(action: string, label: string, o: ActionButtonOptions = {}): string {
  const a = attrs({ 'data-action': action, id: o.id, title: o.title, 'aria-pressed': o.pressed === undefined ? undefined : String(o.pressed), ...dataAttrs(o.extra) });
  return `<button type="button" class="${escapeAttribute(o.className ?? 'btn-ghost')}" ${a}>${o.icon ? iconMarkup(o.icon) : ''}<span>${escapeHtml(label)}</span></button>`;
}

export interface ChipOptions {
  action: string;
  extra?: Record<string, string | number | undefined>;
  selected?: boolean;
  count?: number;
}

export function chip(label: string, o: ChipOptions): string {
  const a = attrs({ 'data-action': o.action, 'aria-pressed': String(Boolean(o.selected)), ...dataAttrs(o.extra) });
  const count = o.count !== undefined ? ` <span class="chip-count">${o.count}</span>` : '';
  return `<li><button type="button" class="chip" ${a}>${escapeHtml(label)}${count}</button></li>`;
}

/**
 * A labelled group of filter chips. The group names what the chips filter
 * (a reader hears "Kategorija, group"); the chips themselves stay a native
 * list, so every `li` has a real list parent and the reader can count them.
 */
export function filterChips(items: string[], label: string): string {
  return `<div class="chips-group" role="group" aria-label="${escapeAttribute(label)}"><ul class="chips" role="list">${items.join('')}</ul></div>`;
}
export interface SearchFieldOptions {
  id: string;
  key: string;
  label: string;
  placeholder: string;
  value: string;
}

/** A labelled search field bound to a view filter key; the value is controlled by the store. */
export function searchField(o: SearchFieldOptions): string {
  return `<div class="field field-search" data-key="${escapeAttribute(o.id)}"><label class="visually-hidden" for="${escapeAttribute(o.id)}">${escapeHtml(o.label)}</label>${iconMarkup('search')}<input type="search" id="${escapeAttribute(o.id)}" data-filter-key="${escapeAttribute(o.key)}" placeholder="${escapeAttribute(o.placeholder)}" value="${escapeAttribute(o.value)}" autocomplete="off"></div>`;
}

export function itemSelection(item: FeedItem): PublicSelection {
  return { kind: 'item', id: publicItemKey(item.module, item.id), module: item.module };
}

export function isSelected(item: FeedItem, selection: PublicSelection | null | undefined): boolean {
  return selection?.kind === 'item' && selection.module === item.module && selection.id === publicItemKey(item.module, item.id);
}

export function findSelected(snapshot: ModuleSnapshot | undefined, selection: PublicSelection | null | undefined): FeedItem | undefined {
  if (!snapshot || selection?.kind !== 'item' || selection.module !== snapshot.module) return undefined;
  return snapshot.items.find((item) => publicItemKey(item.module, item.id) === selection.id);
}

/**
 * The line badge (signage.css `.line`): the number on the front of the
 * vehicle, in its mode's shape and colour. `s` in dense rows and the peek,
 * `m` on boards, `l` on a detail head, `k` on a public screen. `extra` are
 * further attributes on the badge, written as they are named.
 */
export function lineBadge(label: string, kind: 'tram' | 'bus' | 'other', size: 's' | 'm' | 'l' | 'k' = 'm', extra: Record<string, string> = {}): string {
  // A `class` among the extras joins the component's own class list; writing it
  // as a second class attribute would make the parser drop one of the two.
  const { class: extraClass, ...others } = extra;
  const rest = attrs(others);
  const cls = extraClass ? `line ${extraClass}` : 'line';
  return `<span class="${escapeAttribute(cls)}" data-kind="${kind}" data-size="${size}"${rest ? ` ${rest}` : ''}>${escapeHtml(label)}</span>`;
}

export interface SignRowParts {
  /** Trusted markup in the first column: a badge, a time, an icon, nothing. */
  lead: string;
  title: string;
  sub?: string;
  /** Trusted markup in the last column: a delay word, a mark, a chevron. */
  trail?: string;
  /** The reconciler's identity for the row. */
  key: string;
  /** Further attributes on the `li`, written as they are named. */
  attrs?: Record<string, string>;
}

/**
 * A row of the departure board: a lead, a destination, a word for the state.
 * The text arguments are escaped here; `lead` and `trail` are markup other
 * builders produced.
 */
export function signRow(parts: SignRowParts): string {
  const { class: extraClass, ...others } = parts.attrs ?? {};
  const rest = attrs(others);
  const cls = extraClass ? `row ${extraClass}` : 'row';
  const sub = parts.sub ? `<span class="row-sub">${escapeHtml(parts.sub)}</span>` : '';
  return `<li class="${escapeAttribute(cls)}" data-key="${escapeAttribute(parts.key)}"${rest ? ` ${rest}` : ''}>${parts.lead}<span class="row-main"><span class="row-title">${escapeHtml(parts.title)}</span>${sub}</span>${parts.trail ?? ''}</li>`;
}

export interface ItemRowOptions {
  selected?: boolean;
  testid?: string;
  className?: string;
}

/** A row that opens an item's detail. */
export function itemRow(item: FeedItem, body: string, o: ItemRowOptions = {}): string {
  const testid = o.testid ? ` data-testid="${escapeAttribute(o.testid)}"` : '';
  return `<li class="row ${o.className ?? ''}" data-key="${escapeAttribute(item.id)}"${testid}><button type="button" class="row-button" data-action="select" data-module="${escapeAttribute(item.module)}" data-item-id="${escapeAttribute(item.id)}" aria-current="${o.selected ? 'true' : 'false'}">${body}${iconMarkup('chevron-right', undefined, 'icon row-chevron')}</button></li>`;
}

export interface NavLinkOptions {
  icon?: IconName;
  selection?: PublicSelection;
  className?: string;
}

/** A link into another domain, optionally carrying a public selection. */
export function navLink(layer: LayerId, label: string, o: NavLinkOptions = {}): string {
  const selection = o.selection ? ` data-selection="${escapeAttribute(JSON.stringify(o.selection))}"` : '';
  return `<a class="${escapeAttribute(o.className ?? 'link-arrow')}" href="#layer=${layer}" data-action="nav" data-layer="${layer}"${selection}>${o.icon ? iconMarkup(o.icon) : ''}<span>${escapeHtml(label)}</span>${iconMarkup('arrow-up-right', undefined, 'icon icon-sm')}</a>`;
}

export function externalLink(href: string, label: string, className = 'link-ext'): string {
  return `<a class="${escapeAttribute(className)}" href="${escapeAttribute(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}${iconMarkup('external-link', undefined, 'icon icon-sm')}</a>`;
}

/** Item-level actions: copy, share, calendar, print; each carries the module and item id. */
export function itemActions(i18n: I18n, item: FeedItem, o: { calendar?: boolean; print?: boolean } = {}): string {
  const extra = { module: item.module, 'item-id': item.id };
  const parts = [actionButton('copy-item', i18n.t('export.copyItem'), { icon: 'copy', extra })];
  if (item.link) parts.push(actionButton('share-item', i18n.t('export.shareItem'), { icon: 'share-2', extra }));
  if (o.calendar) parts.push(actionButton('ics-item', i18n.t('export.calendarItem'), { icon: 'calendar', extra }));
  if (o.print) parts.push(actionButton('print-item', i18n.t('export.printAct'), { icon: 'printer', extra }));
  return `<div class="actions">${parts.join('')}</div>`;
}

export interface ListDetailOptions {
  list: string;
  detail: string | null;
  detailTitle: string;
}

/** The list + detail shell; on a phone the detail replaces the list with a Back control. */
export function listDetail(i18n: I18n, o: ListDetailOptions): string {
  const back = actionButton('back', i18n.t('shell.detailBack'), { icon: 'arrow-left', className: 'btn-quiet ws-back' });
  const detail = o.detail ? `${back}${o.detail}` : `<p class="ws-detail-hint">${escapeHtml(o.detailTitle)}</p>`;
  return `<div class="ws-split" data-detail-open="${o.detail ? 'true' : 'false'}"><div class="ws-primary" data-key="primary">${o.list}</div><aside class="ws-detail" data-key="detail" aria-label="${escapeAttribute(o.detailTitle)}">${detail}</aside></div>`;
}

export function moduleExport(kind: 'ics' | 'geojson' | 'print', module: ModuleId, label: string): string {
  return actionButton('export', label, { icon: kind === 'print' ? 'printer' : 'download', extra: { kind, module } });
}
