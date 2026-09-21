import { arrivalsAt } from '../../../shared/city/arrivals';
import type { DepartureBoard } from '../../../shared/city/types';
import type { LayerContext } from '../layers/types';
import { vehicleFixes } from '../motion/fixes';
import { platformIds } from '../kiosk/arrivals';
import { arrivalTime } from '../transport/view';
import { escapeHtml as e, escapeAttribute as a } from '../ui/dom/escape';

/** Sada and Karta read the same page-owned departure cache and calculation. */
export function nextDepartures(ctx: LayerContext): string {
  const en=ctx.i18n.getLocale().startsWith('en');
  const saved=ctx.saved?.list().find(ref=>ref.kind==='stop');
  const stop=ctx.screen?.stop??ctx.stops?.find(stop=>stop.id===saved?.id);
  if(!stop)return `<p class="day-stop-prompt">${e(en?'Choose and save a stop on the map to see its next departures here.':'Odaberi i spremi stajalište na karti za sljedeće polaske ovdje.')}</p>`;
  const ids=platformIds(stop,ctx.stops);
  if(!ctx.session?.frozen)ctx.boards?.ensure('zet',ids,ctx.onLocalData);
  const held=ids.map(id=>ctx.boards?.get('zet',id)).filter((b):b is DepartureBoard=>Boolean(b));
  const answer=arrivalsAt(held,vehicleFixes(ctx.snapshots['zet-rt'],ctx.now),ctx.now,{stopIds:ids,rows:3});
  const title=ctx.screen?.stop?(en?'From the screen’s stop':'Sa stajališta zaslona'):(en?'Your saved stop':'Tvoje spremljeno stajalište');
  return `<section class="day-departures" data-testid="day-departures"><p class="city-meta">${e(title)}</p>
    <a class="day-link" href="#layer=u-pokretu&kind=stop&id=${a(stop.id)}" data-action="nav" data-layer="u-pokretu" data-selection="${a(JSON.stringify({kind:'stop',id:stop.id}))}"><h4>${e(stop.name)}</h4> ↗</a>
    ${answer.rows.length?`<ul class="rows">${answer.rows.map(row=>`<li class="day-departure"><strong>${e(row.routeName)}</strong><span>${e(row.headsign||row.routeName)}<small>${e(row.live?(en?'Estimate':'Procjena'):ctx.i18n.t('arrivals.scheduled'))}</small></span>${arrivalTime(ctx.i18n,row,ctx.frozenAt)}</li>`).join('')}</ul>`:
      `<p>${e(ctx.i18n.t(answer.status==='none'?(ctx.session?.frozen?'arrivals.frozen':'status.loading'):answer.status==='down'?'arrivals.down':'arrivals.none'))}</p>`}
    <p class="city-meta">ZET · ${e(ctx.i18n.t('arrivals.note'))}</p></section>`;
}
