// The sections of /statistika/, drawn from one PublicStats. Every function
// here reads the report and writes into a slot the static page already has
// (data-st="..."); the prose around the slots is in the HTML, so the page
// explains itself before and without the numbers.
import { FOLDED_KEY, type PeopleEvent, type PublicStats, type Share, type UsageScope } from '../../../shared/statistika';
import { DISTRICTS } from '../kiosk/districts';
import { escapeHtml } from '../ui/dom/escape';
import { bars, card, columns, empty, hideTip, meter, showTip, stacks, tableDetails, type BarItem } from './charts';
import { FORMS, clock, count, dayLong, dayShort, hourLabel, num, pct, plural, seconds } from './format';
import {
  BUCKETS,
  FOLDED_LABEL,
  ORDER_EVENTS,
  PLAN_EVENTS,
  SIGNS,
  TICK_OUTCOMES,
  areaLabel,
  exportKindLabel,
  layerLabel,
  scanFailLabel,
  sessionKindLabel,
  sourceLabel,
} from './labels';
import { choropleth, dotMap, loadDistricts } from './map';

export type ScopeName = 'venue' | 'evaluation';

const FOLD_METHOD = 'Zbrojevi objavljenih ćelija: zaokruženo na 5, ništa ispod 10; šrafirano je ono što je pravilo praga spojilo.';
const DISTRICT_SLUGS = new Set(DISTRICTS.map((d) => d.slug));

function slot(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-st="${name}"]`);
}

function fill(name: string, ...children: (Node | string)[]): void {
  const el = slot(name);
  if (!el) return;
  el.replaceChildren(...children);
  el.removeAttribute('aria-busy');
}

// ---- helpers over the report --------------------------------------------------------

function ticksFor(days: readonly string[]): { index: number; label: string }[] {
  const n = days.length;
  if (n <= 7) return days.map((d, i) => ({ index: i, label: dayShort(d) }));
  const count = 5;
  return Array.from({ length: count }, (_, k) => {
    const index = Math.round((k * (n - 1)) / (count - 1));
    return { index, label: dayShort(days[index]) };
  });
}

function maxDay(ev: PeopleEvent, days: readonly string[]): { day: string; value: number } | null {
  let best: { day: string; value: number } | null = null;
  ev.daily.forEach((v, i) => {
    if (v !== null && (best === null || v > best.value)) best = { day: days[i], value: v };
  });
  return best;
}

function peakHour(ev: PeopleEvent): number | null {
  const max = Math.max(...ev.hours);
  return max > 0 ? ev.hours.indexOf(max) : null;
}

function items(shares: readonly Share[], label: (key: string, share: Share) => string, skip: (key: string) => boolean = () => false): BarItem[] {
  return shares
    .filter((s) => !skip(s.key) && s.count > 0)
    .map((s) => ({ key: s.key, label: s.key === FOLDED_KEY ? FOLDED_LABEL : label(s.key, s), count: s.count, folded: s.key === FOLDED_KEY }));
}

function dailyTable(caption: string, days: readonly string[], values: readonly (number | null)[], head: string): HTMLElement {
  return tableDetails(caption, ['Dan', head], days.map((d, i) => [dayLong(d), values[i] === null ? 'ispod praga' : num(values[i]!)]));
}

function shareTable(caption: string, list: readonly BarItem[], head: string): HTMLElement {
  return tableDetails(caption, [head, 'Broj'], list.map((i) => [i.label, i.count]));
}

// ---- the window line and the four headline tiles ----------------------------------

export function renderWindow(s: PublicStats): void {
  const el = slot('window');
  if (!el) return;
  el.textContent = `Zadnjih ${s.window.days} dana, od ${dayLong(s.window.since)} do ${dayLong(s.window.today)} Brojevi osvježeni u ${clock(new Date(s.generatedAt))}.`;
  const json = document.querySelector<HTMLAnchorElement>('[data-st="json-link"]');
  if (json) json.href = `/api/statistika?dani=${s.window.days}`;
}

function spark(values: readonly (number | null)[], label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'st-spark';
  el.setAttribute('aria-hidden', 'true');
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  el.style.setProperty('--n', String(values.length));
  el.innerHTML = values
    .map((v) => (v === null ? '<span class="st-col st-col-null"></span>' : `<span class="st-col" style="--h:${max > 0 ? (v / max).toFixed(3) : 0}"></span>`))
    .join('');
  el.title = label;
  return el;
}

function kpi(value: string, label: string, sub: string, extra?: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'st-kpi';
  el.innerHTML = `<p class="st-kpi-value">${escapeHtml(value)}</p><p class="st-kpi-label">${escapeHtml(label)}</p><p class="st-kpi-sub">${escapeHtml(sub)}</p>`;
  if (extra) el.append(extra);
  return el;
}

function sumDaily(a: readonly (number | null)[], b: readonly (number | null)[]): (number | null)[] {
  return a.map((v, i) => (v === null && b[i] === null ? null : (v ?? 0) + (b[i] ?? 0)));
}

export function sourceTotals(s: PublicStats): { ok: number; all: number; error: number } {
  let ok = 0;
  let all = 0;
  let error = 0;
  for (const src of s.system.sources) {
    ok += src.ok;
    error += src.error;
    all += src.ok + src.partial + src.stale + src.error;
  }
  return { ok, all, error };
}

function horizon(s: PublicStats, h: string) {
  return s.system.hindsight.find((x) => x.horizon === h) ?? null;
}

export function renderKpis(s: PublicStats): void {
  const venue = s.venue.session_start.total;
  const evaluation = s.evaluation.session_start.total;
  const sessions = venue + evaluation;
  const src = sourceTotals(s);
  const h30 = horizon(s, '30s');
  const graded = h30 ? Object.values(h30.buckets).reduce((a, b) => a + b, 0) : 0;
  const within50 = h30 ? (h30.buckets.lt25 ?? 0) + (h30.buckets.lt50 ?? 0) : 0;
  fill(
    'kpis',
    kpi(num(sessions), plural(sessions, FORMS.sesija) + ' na zaslonima', sessions > 0 ? `lokacije ${num(venue)}, privremeni zasloni ${num(evaluation)}` : `nijedan dan nije prešao prag od ${s.rules.minCell}`, spark(sumDaily(s.venue.session_start.daily, s.evaluation.session_start.daily), 'Sesije po danu')),
    kpi(num(s.hitno.total), `${plural(s.hitno.total, FORMS.pregled)} Sigurnosti`, s.hitno.total > 0 ? 'bez skeniranja i bez sesije' : `nijedan dan nije prešao prag od ${s.rules.minCell}`, spark(s.hitno.daily, 'Pregledi po danu')),
    kpi(pct(src.ok, src.all), 'dohvata javnih izvora u redu', src.all > 0 ? `${count(src.all, FORMS.dohvat)}, ${num(src.error)} s greškom` : 'još nema dohvata'),
    kpi(pct(within50, graded, 0), 'procjena tramvaja unutar 50 m', graded > 0 ? `30 s unaprijed, ${count(graded, FORMS.procjena)} ocijenjeno` : 'još nema ocijenjenih procjena'),
  );
}

// ---- usage: the scope switch and its cards -----------------------------------------

export function defaultScope(s: PublicStats): ScopeName {
  return s.evaluation.session_start.total > s.venue.session_start.total ? 'evaluation' : 'venue';
}

const SCOPE_NOTE: Record<ScopeName, string> = {
  evaluation: 'Privremeni zaslon može pokrenuti bilo tko na stranici /kiosk/ i vrijedi 24 sata. To je evaluacija prototipa, pa se broji odvojeno i ne ulazi u skup za Grad.',
  venue: 'Zasloni u knjižnicama, kafićima, uredima četvrti i drugim gradskim prostorima. Samo ovi brojevi ulaze u skup za Grad. Pilot na lokacijama počinje s financiranjem projekta.',
};

export function renderScope(s: PublicStats, scope: ScopeName, onChange: (next: ScopeName) => void): void {
  const el = slot('scope');
  if (!el) return;
  const option = (name: ScopeName, label: string): string => {
    const total = s[name].session_start.total;
    return `<button type="button" class="segment" data-scope="${name}" aria-pressed="${name === scope}">${escapeHtml(label)} <span class="st-scope-count">${num(total)}</span></button>`;
  };
  el.innerHTML =
    `<div class="segmented st-scope-switch" role="group" aria-label="Koji zasloni">${option('evaluation', 'Privremeni zasloni')}${option('venue', 'Zasloni na lokacijama')}</div>` +
    `<p class="st-scope-note">${escapeHtml(SCOPE_NOTE[scope])}</p>`;
  el.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = b.dataset.scope as ScopeName;
      if (next !== scope) onChange(next);
    }),
  );
}

function sessionsCard(s: PublicStats, u: UsageScope): HTMLElement {
  const ev = u.session_start;
  const best = maxDay(ev, s.days);
  const body = best
    ? [
        columns({
          values: ev.daily,
          names: s.days.map(dayLong),
          ticks: ticksFor(s.days),
          valueText: (v) => count(v, FORMS.sesija),
          label: 'Sesije po danu',
          summary: `Ukupno ${count(ev.total, FORMS.sesija)}. Najviše ${num(best.value)}, ${dayLong(best.day)}`,
        }),
        dailyTable('Sesije po danu', s.days, ev.daily, 'Sesije'),
      ]
    : [empty(`U ovom razdoblju nijedan dan nije prešao prag od ${s.rules.minCell} sesija.`)];
  return card({
    title: 'Sesije po danu',
    lede: 'Skeniranja zaslona i sesije podijeljene s drugim telefonom.',
    body,
    method: 'Prazno polje znači da taj dan nije objavljen broj: ili je bilo manje od 10 sesija ili nijedna. Pravilo praga ne razlikuje to dvoje.',
    wide: true,
  });
}

function hoursCard(u: UsageScope): HTMLElement {
  const ev = u.session_start;
  const peak = peakHour(ev);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const body: (HTMLElement | string)[] = [];
  if (peak === null) {
    body.push(empty(ev.wholeDay > 0 ? `Nijedan sat nije prešao prag; ${count(ev.wholeDay, FORMS.sesija)} sažeto je na cijeli dan, bez sata.` : 'Još nema sesija iznad praga.'));
  } else {
    body.push(
      columns({
        values: ev.hours,
        names: hours.map((h) => `${h} do ${h + 1} h`),
        ticks: [0, 6, 12, 18, 23].map((h) => ({ index: h, label: hourLabel(h) })),
        valueText: (v) => count(v, FORMS.sesija),
        label: 'Sesije po satu u danu',
        summary: `Najviše između ${peak} i ${peak + 1} h.${ev.wholeDay > 0 ? ` Još ${count(ev.wholeDay, FORMS.sesija)} sažeto je na cijeli dan, bez sata.` : ''}`,
      }),
      tableDetails('Sesije po satu u danu', ['Sat', 'Sesije'], hours.map((h) => [`${h} do ${h + 1} h`, ev.hours[h]]).concat(ev.wholeDay > 0 ? [['bez sata (sažeto na dan)', ev.wholeDay]] : [])),
    );
  }
  return card({ id: 'graf-sati', title: 'Doba dana', lede: 'Zbroj svih dana razdoblja po satu, po zagrebačkom vremenu.', body, method: FOLD_METHOD });
}

function districtsCard(u: UsageScope): HTMLElement {
  const list = items(u.session_start.dim2, (key, share) => areaLabel(key, share.label), (key) => key === '');
  const body: (HTMLElement | string)[] = [];
  if (list.length === 0) {
    body.push(empty('Još nema četvrti iznad praga.'));
  } else {
    const layout = document.createElement('div');
    layout.className = 'st-map-layout';
    const mapSlot = document.createElement('div');
    mapSlot.className = 'st-map-slot';
    mapSlot.innerHTML = '<span class="skeleton"></span>';
    const barList = bars(list, 'Sesije po četvrti', { forms: FORMS.sesija, shares: true });
    layout.append(mapSlot, barList);
    body.push(layout, shareTable('Sesije po četvrti', list, 'Četvrt'));
    const values = new Map(u.session_start.dim2.filter((x) => DISTRICT_SLUGS.has(x.key)).map((x) => [x.key, x.count]));
    whenNear(mapSlot, () =>
      loadDistricts().then((districts) => {
        if (districts.length === 0) {
          mapSlot.remove();
          return;
        }
        mapSlot.replaceChildren(
          choropleth(districts, { values, label: 'Karta gradskih četvrti obojena prema broju sesija', describe: (name, v) => `${name}: ${v === null ? 'nema objavljenog broja' : count(v, FORMS.sesija)}` }, barList),
        );
      }),
    );
  }
  return card({
    id: 'graf-cetvrti',
    title: 'Četvrti',
    lede: 'Gdje su zasloni na kojima su sesije počele. „Cijeli grad” je zaslon postavljen bez jedne četvrti.',
    body,
    method: `${FOLD_METHOD} Četvrt bez boje nema objavljenog broja. Podijeljene sesije nemaju četvrt.`,
    wide: true,
  });
}

function kindsCard(u: UsageScope, scope: ScopeName): HTMLElement {
  const list = items(u.session_start.dim1, sessionKindLabel);
  return card({
    title: scope === 'venue' ? 'Vrsta prostora' : 'Kako je sesija počela',
    lede: scope === 'venue' ? 'U kakvom su prostoru zasloni na kojima ljudi skeniraju.' : 'Skeniranjem zaslona ili dijeljenjem s drugim telefonom.',
    body: list.length ? [bars(list, 'Sesije po vrsti', { forms: FORMS.sesija, shares: true }), shareTable('Sesije po vrsti', list, 'Vrsta')] : [empty('Još nema brojeva iznad praga.')],
    method: FOLD_METHOD,
  });
}

function layersCard(u: UsageScope): HTMLElement {
  const list = items(u.panel_open.dim1, layerLabel);
  return card({
    id: 'graf-slojevi',
    title: 'Što ljudi otvaraju',
    lede: 'Dijelovi aplikacije otvoreni tijekom sesije: Sada, Karta, Vrijeme, Sigurnost, Grad i Događanja.',
    body: list.length ? [bars(list, 'Otvaranja po dijelu aplikacije', { forms: FORMS.otvaranje, shares: true }), shareTable('Otvaranja po dijelu aplikacije', list, 'Dio aplikacije')] : [empty('Još nema otvaranja iznad praga.')],
    method: `${FOLD_METHOD} Najviše 60 događaja po sesiji.`,
  });
}

function exportsCard(u: UsageScope, scope: ScopeName): HTMLElement {
  const list = scope === 'venue' ? items(u.export.dim2, exportKindLabel) : items(u.export.dim1, layerLabel);
  return card({
    title: 'Što ponesu sa sobom',
    lede: scope === 'venue' ? 'Kopirano, podijeljeno, dodano u kalendar, preuzeto ili ispisano.' : 'Po dijelu aplikacije; način izvoza se kod privremenih zaslona ne bilježi.',
    body: list.length ? [bars(list, 'Izvozi', { forms: FORMS.izvoz, shares: true }), shareTable('Izvozi', list, scope === 'venue' ? 'Način' : 'Dio aplikacije')] : [empty('Još nema izvoza iznad praga.')],
    method: FOLD_METHOD,
  });
}

function scanFailsCard(u: UsageScope): HTMLElement {
  const list = items(u.scan_fail.dim1, scanFailLabel);
  return card({
    title: 'Neuspjela skeniranja',
    lede: 'Što treba popraviti da skeniranje uvijek uspije.',
    body: list.length ? [bars(list, 'Neuspjela skeniranja po razlogu', { forms: FORMS.skeniranje, shares: true }), shareTable('Neuspjela skeniranja po razlogu', list, 'Razlog')] : [empty('Nijedan razlog nije prešao prag.')],
    method: `${FOLD_METHOD} Skeniranje koje se ne može povezati ni s jednim zaslonom ne broji se ovdje.`,
  });
}

function screensCard(s: PublicStats, u: UsageScope): HTMLElement {
  const ev = u.kiosk_online;
  const best = maxDay(ev, s.days);
  return card({
    title: 'Uključeni zasloni',
    lede: 'Svaki zaslon broji se jednom na dan kad se uključi.',
    body: best
      ? [
          columns({
            values: ev.daily,
            names: s.days.map(dayLong),
            ticks: ticksFor(s.days),
            valueText: (v) => `${num(v)} ${plural(v, ['zaslon', 'zaslona', 'zaslona'])}`,
            label: 'Uključeni zasloni po danu',
            summary: `Ukupno ${count(ev.total, FORMS.zaslonDan)}.`,
          }),
          dailyTable('Uključeni zasloni po danu', s.days, ev.daily, 'Zasloni'),
        ]
      : [empty(`Nijedan dan nije imao ${s.rules.minCell} ili više uključenih zaslona.`)],
    method: FOLD_METHOD,
  });
}

export function renderUsage(s: PublicStats, scope: ScopeName): void {
  const u = s[scope];
  fill('usage', sessionsCard(s, u), hoursCard(u), kindsCard(u, scope), districtsCard(u), layersCard(u), exportsCard(u, scope), scanFailsCard(u), screensCard(s, u));
}

export function renderHitno(s: PublicStats): void {
  const ev = s.hitno;
  const best = maxDay(ev, s.days);
  fill(
    'hitno',
    card({
      title: 'Sigurnost, bez skeniranja',
      lede: 'Stranica Sigurnost otvorena je svima, bez koda i bez sesije. Broji se svako otvaranje osim robota.',
      body: best
        ? [
            columns({
              values: ev.daily,
              names: s.days.map(dayLong),
              ticks: ticksFor(s.days),
              valueText: (v) => count(v, FORMS.pregled),
              label: 'Pregledi stranice Sigurnost po danu',
              summary: `Ukupno ${count(ev.total, FORMS.pregled)}. Najviše ${num(best.value)}, ${dayLong(best.day)}`,
            }),
            dailyTable('Pregledi stranice Sigurnost po danu', s.days, ev.daily, 'Pregledi'),
          ]
        : [empty(`Nijedan dan nije prešao prag od ${s.rules.minCell} pregleda.`)],
      method: FOLD_METHOD,
      wide: true,
    }),
  );
}

// ---- what the City gets: one live line per value card ------------------------------

function topShare(shares: readonly Share[], skip: (key: string) => boolean = () => false): Share | null {
  return shares.find((x) => x.key !== FOLDED_KEY && !skip(x.key) && x.count > 0) ?? null;
}

export function renderValues(s: PublicStats, scope: ScopeName): void {
  const u = s[scope];
  const set = (name: string, text: string): void => {
    const el = slot(name);
    if (el) el.textContent = text;
  };
  const area = topShare(u.session_start.dim2, (k) => k === '' || k === 'zagreb');
  set('value-where', area ? `Najviše sesija: ${areaLabel(area.key, area.label)} (${num(area.count)}).` : 'Još nema četvrti iznad praga.');
  const peak = peakHour(u.session_start);
  set('value-when', peak === null ? 'Još nema sata iznad praga.' : `Najviše sesija između ${peak} i ${peak + 1} h.`);
  const layer = topShare(u.panel_open.dim1);
  set('value-what', layer ? `Najčešće otvarano: ${layerLabel(layer.key)}.` : 'Još nema otvaranja iznad praga.');
  const worst = [...s.system.sources]
    .map((x) => ({ x, all: x.ok + x.partial + x.stale + x.error }))
    .filter((r) => r.all > 0)
    .sort((a, b) => a.x.ok / a.all - b.x.ok / b.all)[0];
  set('value-sources', worst ? `Najslabiji izvor: ${sourceLabel(worst.x.module)}, ${pct(worst.x.ok, worst.all)} u redu.` : 'Još nema zapisanih dohvata.');
  const j = s.system.live?.junctions[0];
  set('value-trams', j ? `Najviše čekanja${j.near ? ` kod stajališta ${j.near}` : ''}: stane ${pct(j.waits, j.passes, 0)} prolaza, medijan ${seconds(j.p50)}.` : 'Karta čekanja pojavit će se kad model skupi dovoljno prolaza.');
}

// ---- sources -----------------------------------------------------------------------

export function renderSources(s: PublicStats): void {
  const list = s.system.sources;
  if (list.length === 0) {
    fill('sources', empty('U ovom razdoblju nema zapisanih dohvata.'));
    return;
  }
  const rows = list.map((x) => {
    const all = x.ok + x.partial + x.stale + x.error;
    return {
      label: sourceLabel(x.module),
      parts: [
        { key: 'ok', label: 'U redu', count: x.ok, tone: 'st-tone-ok' },
        { key: 'partial', label: 'Djelomično', count: x.partial, tone: 'st-tone-partial' },
        { key: 'stale', label: 'Zadnja dobra kopija', count: x.stale, tone: 'st-tone-stale' },
        { key: 'error', label: 'Greška', count: x.error, tone: 'st-tone-error' },
      ],
      summary: `${pct(x.ok, all)} u redu · ${num(all)}`,
    };
  });
  fill(
    'sources',
    card({
      title: 'Dohvati po izvoru',
      lede: 'Svaki redak je jedan izvor; traka je sto posto njegovih dohvata u razdoblju.',
      body: [
        stacks(
          rows,
          [
            { tone: 'st-tone-ok', label: 'U redu' },
            { tone: 'st-tone-partial', label: 'Djelomično' },
            { tone: 'st-tone-stale', label: 'Zadnja dobra kopija' },
            { tone: 'st-tone-error', label: 'Greška' },
          ],
          'Dohvati po izvoru',
        ),
        tableDetails('Dohvati po izvoru', ['Izvor', 'U redu', 'Djelomično', 'Zadnja dobra kopija', 'Greška'], list.map((x) => [sourceLabel(x.module), x.ok, x.partial, x.stale, x.error])),
      ],
      method: 'Točni brojevi dohvata poslužitelja; nisu o ljudima. Djelomično: dio izvora je odgovorio. Zadnja dobra kopija: izvor nije odgovorio, pa je poslužen zadnji ispravan odgovor s oznakom starosti.',
      wide: true,
    }),
  );
}

// ---- trams -------------------------------------------------------------------------

const RAMP = ['st-ramp-0', 'st-ramp-1', 'st-ramp-2', 'st-ramp-3', 'st-ramp-4'];
const BUCKET_KEYS = ['lt25', 'lt50', 'lt100', 'lt200', 'ge200'];
const BUCKET_REACH: Record<string, string> = { lt25: '25 m', lt50: '50 m', lt100: '100 m', lt200: '200 m', ge200: 'više od 200 m' };

function medianBucket(buckets: Record<string, number>): string | null {
  const total = BUCKET_KEYS.reduce((a, k) => a + (buckets[k] ?? 0), 0);
  if (total === 0) return null;
  let run = 0;
  for (const k of BUCKET_KEYS) {
    run += buckets[k] ?? 0;
    if (run / total >= 0.5) return k;
  }
  return 'ge200';
}

/** A day's health as a status word: the share of its ticks that read the feed. */
function healthTone(share: number | null): { tone: string; word: string } {
  if (share === null) return { tone: 'st-strip-none', word: 'bez otkucaja' };
  if (share >= 0.99) return { tone: 'st-tone-ok', word: '99 % i više' };
  if (share >= 0.95) return { tone: 'st-tone-stale', word: '95 do 99 %' };
  return { tone: 'st-tone-error', word: 'ispod 95 %' };
}

function strip(s: PublicStats): HTMLElement {
  const el = document.createElement('div');
  el.className = 'st-stripchart';
  const shares = s.system.ticksAll.map((a, i) => (a > 0 ? s.system.ticksGood[i] / a : null));
  const cells = shares
    .map((v, i) => {
      const h = healthTone(v);
      return `<span class="st-strip-cell ${h.tone}" data-tip="${escapeHtml(`${dayLong(s.days[i])}: ${v === null ? h.word : `${pct(v, 1)} u redu`}`)}"></span>`;
    })
    .join('');
  const worst = shares.reduce<{ i: number; v: number } | null>((w, v, i) => (v !== null && (w === null || v < w.v) ? { i, v } : w), null);
  const legend = ['st-tone-ok', 'st-tone-stale', 'st-tone-error', 'st-strip-none']
    .map((tone) => `<li><span class="st-swatch ${tone}"></span>${escapeHtml({ 'st-tone-ok': '99 % i više', 'st-tone-stale': '95 do 99 %', 'st-tone-error': 'ispod 95 %', 'st-strip-none': 'bez otkucaja' }[tone]!)}</li>`)
    .join('');
  el.innerHTML =
    `<ul class="st-legend" aria-hidden="true">${legend}</ul>` +
    `<div class="st-strip" style="--n:${shares.length}" aria-hidden="true">${cells}</div>` +
    `<p class="st-readout">${worst ? escapeHtml(`Najslabiji dan: ${dayLong(s.days[worst.i])}, ${pct(worst.v, 1)} u redu.`) : ''}</p>`;
  el.addEventListener('pointerover', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (cell) showTip(cell.getBoundingClientRect(), escapeHtml(cell.dataset.tip ?? ''));
  });
  el.addEventListener('pointerleave', hideTip);
  return el;
}

function healthCard(s: PublicStats): HTMLElement {
  const t = s.system.ticks;
  const good = (t.ok ?? 0) + (t.unchanged ?? 0);
  const all = good + (t.error ?? 0) + (t.stale_index ?? 0);
  const body: (HTMLElement | string)[] = [];
  if (all === 0) body.push(empty('Model se u ovom razdoblju još nije oglasio.'));
  else {
    body.push(
      meter(good, all, 'Udio otkucaja koji su pročitali feed'),
      `${count(all, FORMS.otkucaj)}, jedan svakih 10 sekundi. ${num(s.system.coldTicks)} nakon ponovnog pokretanja.`,
      strip(s),
      tableDetails('Otkucaji modela po ishodu', ['Ishod', 'Otkucaji'], Object.entries(t).map(([k, v]) => [TICK_OUTCOMES[k] ?? k, v])),
    );
  }
  return card({ title: 'Model radi dan i noć', lede: 'Otkucaj je jedno buđenje modela: pročita feed, pomakne tramvaje i objavi procjene. Svaki kvadratić je jedan dan.', body, method: 'U redu: novo ili isto očitanje. Ostalo: izvor nije odgovorio ili je voznom redu većina vožnji bila nepoznata.' });
}

function accuracyCard(s: PublicStats): HTMLElement {
  const rows = s.system.hindsight.map((h) => {
    const median = medianBucket(h.buckets);
    return {
      label: `${h.horizon.replace('s', '')} s unaprijed`,
      parts: BUCKET_KEYS.map((k, i) => ({ key: k, label: BUCKETS[k], count: h.buckets[k] ?? 0, tone: RAMP[i] })),
      summary: median ? `pola do ${BUCKET_REACH[median]}` : 'nema ocjena',
    };
  });
  const any = s.system.hindsight.some((h) => BUCKET_KEYS.some((k) => (h.buckets[k] ?? 0) > 0));
  return card({
    title: 'Koliko je procjena bila daleko',
    lede: 'Kad stigne novo očitanje, uspoređuje se s procjenom objavljenom 10, 30 i 60 sekundi ranije.',
    body: any
      ? [
          stacks(rows, BUCKET_KEYS.map((k, i) => ({ tone: RAMP[i], label: BUCKETS[k] })), 'Udaljenost procjene od stvarnog položaja'),
          tableDetails('Udaljenost procjene od stvarnog položaja', ['Horizont', ...BUCKET_KEYS.map((k) => BUCKETS[k])], s.system.hindsight.map((h) => [`${h.horizon.replace('s', '')} s`, ...BUCKET_KEYS.map((k) => h.buckets[k] ?? 0)])),
        ]
      : [empty('Još nema ocijenjenih procjena.')],
    method: 'Udaljenost se mjeri po tračnicama. Jače obojeno je bliže.',
    wide: true,
  });
}

function signCard(s: PublicStats): HTMLElement {
  const keys = ['ahead_ge50', 'within50', 'behind_ge50'];
  const tones: Record<string, string> = { ahead_ge50: 'st-sign-ahead', within50: 'st-sign-within', behind_ge50: 'st-sign-behind' };
  const rows = s.system.hindsight.map((h) => {
    const total = keys.reduce((a, k) => a + (h.sign[k] ?? 0), 0);
    return {
      label: `${h.horizon.replace('s', '')} s unaprijed`,
      parts: keys.map((k) => ({ key: k, label: SIGNS[k], count: h.sign[k] ?? 0, tone: tones[k] })),
      summary: `${pct(h.sign.ahead_ge50 ?? 0, total, 0)} ispred`,
    };
  });
  const any = s.system.hindsight.some((h) => keys.some((k) => (h.sign[k] ?? 0) > 0));
  return card({
    title: 'Ispred ili iza tramvaja',
    lede: 'Procjena ispred tramvaja obećava da je bliže nego što jest; to je greška koju model najviše izbjegava.',
    body: any
      ? [
          stacks(rows, keys.map((k) => ({ tone: tones[k], label: SIGNS[k] })), 'Procjene ispred, unutar 50 m i iza tramvaja', { at: 0.1, label: 'Cilj: najviše 10 % procjena ispred tramvaja na 30 s' }),
          tableDetails('Procjene po predznaku', ['Horizont', ...keys.map((k) => SIGNS[k])], s.system.hindsight.map((h) => [`${h.horizon.replace('s', '')} s`, ...keys.map((k) => h.sign[k] ?? 0)])),
        ]
      : [empty('Još nema ocijenjenih procjena.')],
    method: 'Ispred ili iza znači 50 m ili više od stvarnog položaja.',
  });
}

function junctionsCard(s: PublicStats): HTMLElement {
  const live = s.system.live;
  const list = live?.junctions ?? [];
  const body: (HTMLElement | string)[] = [];
  if (list.length === 0) {
    body.push(empty(live ? 'Model još nije skupio dovoljno prolaza kroz križanja.' : 'Tablice modela trenutačno nisu dostupne.'));
  } else {
    const maxCost = Math.max(...list.map((j) => j.share * (j.p50 ?? 0)));
    const layout = document.createElement('div');
    layout.className = 'st-map-layout';
    const mapSlot = document.createElement('div');
    mapSlot.className = 'st-map-slot';
    mapSlot.innerHTML = '<span class="skeleton"></span>';
    const ranking = bars(
      list.map((j, i) => ({
        key: String(i + 1),
        label: j.near ? `Kod stajališta ${j.near}` : 'Križanje bez obližnjeg stajališta',
        note: `stane ${pct(j.waits, j.passes, 0)} od ${count(j.passes, FORMS.prolaz)}`,
        count: j.p50 ?? 0,
      })),
      'Križanja na kojima tramvaji čekaju',
      { valueText: (v) => `medijan ${seconds(v)}`, ordered: true },
    );
    layout.append(mapSlot, ranking);
    body.push(layout);
    whenNear(mapSlot, () =>
      loadDistricts().then((districts) => {
        if (districts.length === 0) {
          mapSlot.remove();
          return;
        }
        mapSlot.replaceChildren(
          dotMap(
            districts,
            list.map((j, i) => ({
              lon: j.lon,
              lat: j.lat,
              weight: maxCost > 0 ? (j.share * (j.p50 ?? 0)) / maxCost : 0,
              rank: i + 1,
              label: `${i + 1}. ${j.near ? `kod stajališta ${j.near}` : 'križanje'}: stane ${pct(j.waits, j.passes, 0)} prolaza, medijan ${seconds(j.p50)}`,
            })),
            'Karta križanja na kojima tramvaji čekaju',
          ),
        );
      }),
    );
  }
  return card({
    id: 'graf-krizanja',
    title: 'Gdje tramvaji čekaju',
    lede: 'Križanja na kojima tramvaj najčešće i najdulje stoji. Redoslijed je očekivano čekanje po prolazu: udio prolaza sa stajanjem puta medijan stajanja.',
    body,
    method: live ? `Mjereno za ovo doba dana i ovu vrstu dana, stanje u ${clock(new Date(live.at * 1000))}. Model prati ${num(live.junctionsKnown)} križanja.` : undefined,
    wide: true,
  });
}

function dwellCard(s: PublicStats): HTMLElement {
  const live = s.system.live;
  const list = live?.stops ?? [];
  return card({
    title: 'Koliko tramvaj stoji na stajalištu',
    lede: 'Stajališta s najviše izmjerenih zaustavljanja i medijan njihova trajanja.',
    body: list.length
      ? [
          bars(
            list.map((x) => ({ key: x.name, label: x.name, note: `${count(x.samples, FORMS.uzorak)}, model računa ${seconds(x.plannedSec)}`, count: x.p50 ?? 0 })),
            'Trajanje zaustavljanja po stajalištu',
            { valueText: (v) => seconds(v) },
          ),
        ]
      : [empty(live ? 'Model još nije izmjerio dovoljno zaustavljanja.' : 'Tablice modela trenutačno nisu dostupne.')],
    method: live ? `Model zna nešto o ${num(live.stopsKnown)} perona. Mjerenja za ovo doba dana.` : undefined,
  });
}

function timetableCard(s: PublicStats): HTMLElement {
  const w = s.system.timetable;
  const checks = Object.values(w).reduce((a, b) => a + b, 0);
  const plan = s.system.plan.filter((p) => p.count > 0);
  const order = s.system.order.filter((p) => p.count > 0);
  return card({
    title: 'Vozni red',
    lede: 'Svaki sat aplikacija provjerava je li ZET objavio noviji vozni red od onoga ugrađenog.',
    body: [
      checks > 0 ? `${count(checks, FORMS.provjera)}; noviji vozni red zatečen ${num(w.newer ?? 0)} ${plural(w.newer ?? 0, ['put', 'puta', 'puta'])}.` : 'U ovom razdoblju nema zapisanih provjera.',
      ...(plan.length ? [tableDetails('Zahvati planera', ['Zahvat', 'Broj'], plan.map((p) => [PLAN_EVENTS[p.key] ?? p.key, p.count]), 'Kako se model sam ispravlja')] : []),
      ...(order.length ? [tableDetails('Redoslijed tramvaja na istim tračnicama', ['Događaj', 'Broj'], order.map((p) => [ORDER_EVENTS[p.key] ?? p.key, p.count]), 'Redoslijed tramvaja na istim tračnicama')] : []),
    ],
  });
}

export function renderTrams(s: PublicStats): void {
  fill('trams', healthCard(s), timetableCard(s), accuracyCard(s), signCard(s), dwellCard(s), junctionsCard(s));
}

// ---- lazy work ---------------------------------------------------------------------

/** Runs once when the element comes within a screen of the viewport. */
function whenNear(el: HTMLElement, run: () => unknown): void {
  if (!('IntersectionObserver' in window)) {
    void run();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void run();
      }
    },
    { rootMargin: '100% 0px' },
  );
  io.observe(el);
}

export function renderAll(s: PublicStats, scope: ScopeName, onScope: (next: ScopeName) => void): void {
  renderWindow(s);
  renderKpis(s);
  renderScope(s, scope, onScope);
  renderUsage(s, scope);
  renderHitno(s);
  renderValues(s, scope);
  renderSources(s);
  renderTrams(s);
}

/** Every slot back to a quiet failure note, with a way to try again. */
export function renderError(retry: () => void): void {
  const note = (): HTMLElement => {
    const p = empty('Brojevi se trenutačno ne mogu učitati.');
    p.dataset.kind = 'down';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-ghost st-retry';
    b.textContent = 'Pokušaj ponovno';
    b.addEventListener('click', retry);
    const actions = document.createElement('span');
    actions.className = 'state-actions';
    actions.append(b);
    p.append(actions);
    return p;
  };
  const w = slot('window');
  if (w) w.textContent = 'Brojevi se trenutačno ne mogu učitati.';
  for (const name of ['kpis', 'usage', 'sources', 'trams']) fill(name, note());
  fill('hitno');
  fill('scope');
}

