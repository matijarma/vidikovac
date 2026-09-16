// The unpaired composition (plan "Frame", R-KP1): the field on the left, the
// window onto the kvart (kiosk/field.ts), and the column on the right -- a
// headless stack of at most a few ranked statements in words (label, value,
// context; say.ts ranks and writes them, R-KP5) over the fixed, accent-filled
// invitation card with the rotating QR, the lead, the hint and the readable
// code. Built once; update() hands the field its model and paints the column
// through ui/dom/reconcile.ts, so only the nodes whose content changed are
// touched, a changed value swaps its own node (data-replace by data-sig: the
// k-say-in keyframe replays on insertion, with no timer), and the map
// container the controller hosts and the code the rotation paints are never
// rewritten by a poll.
//
// The header carries the weather (D11) and the strip the safety words, so
// nothing here says either. The markup helpers the compositions share (the
// badge, the kicker, the lines board, the card's own pieces) live in
// kiosk/markup.ts, so field.ts and say.ts can draw with them without a cycle
// through this file. A phone gets this same composition at the handheld
// tokens; there is no second one for it.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import type { I18n } from '../i18n/i18n';
import { reconcile } from '../ui/dom/reconcile';
import { escapeHtml } from '../ui/dom/escape';
import { mountField, type FieldHandle } from './field';
import { SAY_BADGE_CAP, SAY_SLOTS, SAY_VALUE_CHARS, type Composition } from './layout';
import { byModule } from './local';
import { codeBlockMarkup, hintMarkup } from './markup';
import { rankStatements, sayMarkup, type Slot } from './say';
import type { KioskStrings } from './strings';

export interface InvitationDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  /** The origin the QR points at; the hint names its hostname. Production when absent. */
  codeBase?: string;
}

export interface InvitationModel {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  /** The stop's last-departure table (R-KP6), null until it answers or without one. */
  lastRun: LastRunSnapshot | null;
  /** Which of the four drawings this is: decides how many statements the column asks for and how long a title it keeps (kiosk/layout.ts). */
  composition: Composition;
}

export interface InvitationHandle {
  element: HTMLElement;
  /** The field's map host, the box the controller hosts the one map in; null under lagano, which has no map. */
  readonly mapHost: HTMLElement | null;
  update(model: InvitationModel): void;
  /** The field's laid-out width for the camera (kiosk/field.ts); 0 before layout. */
  measureWidth(): number;
  /** Contract 3: the map's placed major street names, counted, onto the map host. */
  setMajorLabels(count: number): void;
  /** Re-measures the column: a value past two lines is shortened at a word, a statement the room does not hold is hidden whole (R-KP5); called after every update and on the 1 s tick, so fonts arriving late and a resize are absorbed. */
  fit(): void;
  destroy(): void;
}

/** The column (contract 4): the statements, then the card whose QR and code the rotation paints. The lead is the page's one h1. */
function columnMarkup(s: KioskStrings, codeBase?: string): string {
  return `<div class="k-says" data-testid="kiosk-says" aria-live="off"></div>
    <article class="k-invite" data-testid="kiosk-invite">
      <h1 class="k-lead">${escapeHtml(s.invitation.lead)}</h1>
      <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
      ${hintMarkup(s, codeBase)}
      ${codeBlockMarkup(s)}
    </article>`;
}

/** A loading slot in the contract's shape (contract 4): what the column shows
 *  while zet-rt has not answered and say.ts has nothing to write yet, so a cold
 *  screen is never a blank column. Once say.ts renders its own skeleton this
 *  never shows. */
const SKELETON = '<article class="k-say" data-skeleton aria-hidden="true"><span class="sk k-say-sk-label"></span><span class="sk k-say-sk-value"></span><span class="sk k-say-sk-context"></span></article>';

/** A value is at most this many lines of the main tier (R-KP5); a longer one is shortened at a word by measurement, never ellipsised by CSS. */
export const VALUE_LINES = 2;

export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const { strings: s, i18n, locale, lightweight } = deps;
  const element = document.createElement('section');
  element.className = 'k-invitation';
  element.dataset.testid = 'kiosk-invitation';
  host.appendChild(element);
  // The field takes the grid's first column, the column the second.
  const field: FieldHandle = mountField(element, { lightweight });
  const column = document.createElement('aside');
  column.className = 'k-column';
  column.innerHTML = columnMarkup(s, deps.codeBase);
  element.appendChild(column);
  const says = column.querySelector<HTMLElement>('[data-testid=kiosk-says]')!;
  /** The ranker's own last answer, handed back for hysteresis (contract 5). */
  let previous: Slot[] = [];
  let lastSays = '';

  /** A value made of words is cut at a word boundary with "…" until it fits
   *  VALUE_LINES of its own line-height; its data-sig is the whole text, so
   *  the next reconcile keeps the node and this runs again on it. A value
   *  made of pairs (the last departures' badges and times) wraps as its
   *  badges dictate and is left alone. A DOM without layout measures nothing.
   *  Lines are the box's height over its line-height, never its scrollHeight:
   *  a 1.1 line box lets the face's ascenders and descenders paint a few
   *  pixels past it, which is ink, not a line. */
  function clampValue(article: HTMLElement): void {
    const value = article.querySelector<HTMLElement>('.k-say-value');
    if (!value || value.children.length > 0 || value.clientHeight === 0) return;
    const whole = value.dataset.sig ?? value.textContent ?? '';
    if (value.textContent !== whole) value.textContent = whole;
    const lineHeight = Number.parseFloat(getComputedStyle(value).lineHeight);
    if (!(lineHeight > 0)) return;
    const lines = (): number => Math.round(value.clientHeight / lineHeight);
    let text = whole;
    while (lines() > VALUE_LINES) {
      const cut = text.replace(/…$/, '').trimEnd().lastIndexOf(' ');
      if (cut <= 0) break;
      text = `${text.slice(0, cut).trimEnd()}…`;
      value.textContent = text;
    }
  }

  /** Every statement whole or not at all: the ones the column's box does not
   *  hold are hidden from the foot up and counted by nobody -- a half-shown
   *  statement is the hole a fixed frame reads as a fault. The column's slot
   *  count (kiosk/layout.ts SAY_SLOTS) is the most the ranker offers; the
   *  room decides the rest. */
  function fit(): void {
    const items = [...says.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
    for (const item of items) {
      item.hidden = false;
      clampValue(item);
    }
    if (says.clientHeight === 0) return;
    let shown = items;
    while (shown.length > 1 && says.scrollHeight > says.clientHeight + 1) {
      shown[shown.length - 1]!.hidden = true;
      shown = shown.slice(0, -1);
    }
  }

  function paintSays(model: InvitationModel): void {
    previous = rankStatements({
      modules: model.modules, stop: model.stop, now: model.now, lastRun: model.lastRun, strings: s, i18n, locale,
      slots: SAY_SLOTS[model.composition], badgeCap: SAY_BADGE_CAP[model.composition], valueChars: SAY_VALUE_CHARS[model.composition],
    }, previous);
    // Loading is zet-rt not having answered at all; a down or stale source is an answer and say.ts words it.
    const loading = byModule(model.modules)['zet-rt'] === undefined;
    const html = sayMarkup(previous, { strings: s, locale, loading }) || (loading ? SKELETON : '');
    if (html === lastSays) return;
    lastSays = html;
    const next = document.createElement('div');
    next.innerHTML = html;
    reconcile(says, next);
    fit();
  }

  return {
    element,
    get mapHost() { return field.mapHost; },
    update(model) {
      field.update({ modules: model.modules, stop: model.stop, strings: s, i18n, locale });
      paintSays(model);
    },
    measureWidth: () => field.measureWidth(),
    setMajorLabels: (count) => field.setMajorLabels(count),
    fit,
    destroy() {
      field.destroy();
      element.remove();
    },
  };
}
