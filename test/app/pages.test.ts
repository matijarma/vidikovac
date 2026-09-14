import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const DEVIATION =
  'Odstupanje: vremensko ograničenje sesije. Prikaz nadzorne ploče traje najviše 10 minuta po skeniranju i ne može se produljiti, isključiti ni prilagoditi (WCAG 2.2, kriterij uspješnosti 2.2.1 Prilagodljivo vrijeme).';

/** The markup from an opening marker to the next closing tag of that kind. */
function section(html: string, openMarker: string, closeTag: string): string {
  const start = html.indexOf(openMarker);
  expect(start, openMarker).toBeGreaterThanOrEqual(0);
  const end = html.indexOf(closeTag, start);
  expect(end, closeTag).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('vite multi-page inputs', () => {
  it('builds every page of the product', () => {
    const input = (config as { build?: { rollupOptions?: { input?: Record<string, string> } } }).build!.rollupOptions!.input!;
    expect(Object.keys(input).sort()).toEqual(['d', 'index', 'izvori', 'kiosk', 'pristupacnost', 'privatnost', 's'].sort());
    for (const path of Object.values(input)) expect(path.endsWith('index.html')).toBe(true);
  });
  it('injects the source list into /izvori at build time', () => {
    const plugins = (config as { plugins?: { name: string; transformIndexHtml?: unknown }[] }).plugins ?? [];
    const plugin = plugins.find((p) => p.name === 'vidikovac-izvori')!;
    expect(plugin).toBeDefined();
    const handler = (plugin.transformIndexHtml as { handler: (html: string, ctx: { path: string }) => string }).handler;
    const html = handler('<main><!--IZVORI--></main>', { path: '/izvori/index.html' });
    expect(html).toContain('<article class="izvor"');
    expect(html).not.toContain('<!--IZVORI-->');
    expect(handler('<main><!--IZVORI--></main>', { path: '/index.html' })).toContain('<!--IZVORI-->');
  });
});

describe('static pages', () => {
  it('the landing page is in the present tense and links to every public route', () => {
    const html = read('app/index.html');
    // R-57: an evaluator who types the URL from the proposal must land on a
    // working product, not on an "under construction" notice.
    expect(html).not.toContain('Prototip u izgradnji');
    expect(html).not.toContain('bit će otvoren');
    // R-P8: the retired proposition never reappears on the landing page.
    expect(html).not.toContain('Plaća se pažnjom');
    expect(html).toContain('Nitko ništa ne plaća, ni novcem ni pažnjom');
    expect(html).toContain('bez skeniranja i bez ograničenja trajanja');
    expect(html).toContain('href="/hitno"');
    // R-K6: the self-service screen stays reachable as a quiet link with its pinned text.
    expect(html).toContain('data-testid="cta-kiosk"');
    expect(html).toMatch(/href="\/kiosk\/"[^>]*data-testid="cta-kiosk"|data-testid="cta-kiosk"[^>]*href="\/kiosk\/"/);
    expect(html).toContain('Otvori gradski zaslon');
    expect(html).not.toContain('ld-domains');
    for (const href of ['/hitno', '/s/', '/izvori/', '/open/', '/privatnost/', '/pristupacnost/']) {
      expect(html, href).toContain(`href="${href}"`);
    }
    // How to find a screen at all, in one sentence.
    expect(html).toContain('priđi mu, skeniraj kod kamerom ili upiši osam slova');
    // The shared token system, not an inline palette; one h1; no panorama,
    // meander or gallery caption (PRODUCT.md anti-references).
    expect(html).toContain('href="/src/ui/tokens.css"');
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('Inter');
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain('Kaj ima?');
    expect(html).not.toContain('Vidikovac');
    expect(html).not.toMatch(/<canvas/);
    expect(html).not.toContain('panorama');
    expect(html).not.toContain('meander');
    expect(html).not.toMatch(/SL\. \d/);
    // The live strip is real data painted by the entry; before it runs the
    // markup says loading, never a number.
    expect(html).toContain('data-testid="live-strip"');
    expect(html).toContain('data-live="weather"');
    expect(html).toContain('data-live="safety"');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).toContain('id="health"');
    // The strip and health line live in the external module entry, never
    // inline (CSP: script-src 'self').
    expect(html).toContain('src="/src/entries/landing.ts"');
    expect(html).not.toContain('/src/health.ts');
  });

  // T4.4 (plan "Entry", R-K6): the landing on a phone. Scanning is the primary
  // action on every width, the kiosk a quiet link one line below; the city's
  // live strip follows the actions directly, so it is above the fold at 390 by
  // 844 (e2e/mobile.spec.ts measures the fold; this pins the order and roles).
  it('the landing puts scanning first: header link to /s/ at every width, stacked actions with the scan action first, the live strip right after them', () => {
    const html = read('app/index.html');
    const head = section(html, '<header class="ld-head"', '</header>');
    // The header: wordmark with the peacock question mark, Sigurnost, Upiši kod, the language toggle slot; no button.
    expect(head).toContain('class="ki-wordmark-mark">?</span>');
    expect(head).toContain('href="/hitno"');
    expect(head).toMatch(/<a[^>]*href="\/s\/"[^>]*>Upiši kod<\/a>/);
    expect(head).toContain('data-lang-toggle');
    expect(head).not.toContain('class="btn');
    expect(head).not.toContain('/kiosk/');
    // The hero: no kicker above the h1 (kickers are retired everywhere, so none on the page); the lead verbatim; the three actions in order and role.
    const hero = section(html, '<section class="ld-hero"', '</section>');
    expect(html).not.toContain('kicker');
    expect(hero).toContain('Deset minuta grada na tvom uređaju.');
    expect(hero).toContain('Promet, vrijeme, događanja, odluke Grada, sigurnost i vijesti iz otvorenih podataka, s izvorom uz svaki prikaz. Bez računa, bez instalacije, bez praćenja.');
    expect(hero).toMatch(/<a class="btn btn-primary" href="\/s\/" data-testid="cta-scan"[^>]*>Skeniraj ili upiši kod<\/a>/);
    expect(hero).toMatch(/<a class="btn-ghost" href="\/hitno" data-testid="cta-safety"[^>]*>Sigurnost, bez skeniranja<\/a>/);
    expect(hero).toMatch(/<a class="btn-quiet" href="\/kiosk\/" data-testid="cta-kiosk"[^>]*>Otvori gradski zaslon<\/a>/);
    const scan = html.indexOf('data-testid="cta-scan"');
    const safety = html.indexOf('data-testid="cta-safety"');
    const kiosk = html.indexOf('data-testid="cta-kiosk"');
    expect(scan).toBeGreaterThan(0);
    expect(scan).toBeLessThan(safety);
    expect(safety).toBeLessThan(kiosk);
    // "Nitko ništa ne plaća…" moved out of the lead into "Kako radi"; the kiosk explainer paragraph is gone from the hero.
    expect(hero).not.toContain('Nitko ništa ne plaća');
    expect(hero).not.toContain('Gradski zaslon je pravi zaslon');
    const how = section(html, '<section class="ld-how"', '</section>');
    expect(how).toContain('Nitko ništa ne plaća, ni novcem ni pažnjom');
    // Step 3's second sentence is the link itself (a 44 px target in landing.css), never one word inside prose.
    expect(how).toMatch(/<a class="ld-step-link" href="\/hitno"[^>]*>Sigurnost je otvorena svima, bez skeniranja i bez ograničenja trajanja\.<\/a>/);
    // The live strip section follows the hero directly, three cells with their data-live spans intact.
    const actionsEnd = html.indexOf('</section>', html.indexOf('data-testid="landing-actions"'));
    const live = html.indexOf('<section class="ld-live"');
    expect(live).toBeGreaterThan(actionsEnd);
    expect(html.slice(actionsEnd, live).replace(/\s/g, '')).toBe('</section>');
    // The strip's head is a sentence-case secondary head, not an uppercase kicker.
    expect(html).toMatch(/<h2 id="ld-live-title" class="ld-live-title"[^>]*>Sada u Zagrebu<\/h2>/);
    const strip = section(html, '<ul class="ld-strip"', '</ul>');
    expect(strip.match(/<li>/g)).toHaveLength(3);
    // The values stay Croatian under the English toggle (liveStripTexts is pinned), so they say so: lang="hr" keeps hyphenation and speech right.
    for (const key of ['weather', 'safety', 'transit']) expect(strip).toMatch(new RegExp(`<span class="ld-v" data-live="${key}"[^>]*lang="hr"`));
    // The footer's health line is the status region itself, a sentence painted by paintHealth.
    expect(html).toMatch(/<p class="ld-health" role="status" id="health" lang="hr">/);
    expect(html).not.toContain('Stanje poslužitelja');
    expect(html).not.toContain('<code id="health"');
  });

  it('landing.css: the type roles, the stacked actions, the three-cell strip from 22rem, no hidden header link, hover only under (hover: hover)', () => {
    const css = read('app/src/ui/landing.css');
    expect(css).not.toContain('display: none');
    expect(css).toMatch(/\.ld-hero h1 \{[^}]*font-size: clamp\(var\(--type-display\), 5vw, 2\.5rem\)/);
    expect(css).toMatch(/\.ld-actions \{ display: grid; gap: var\(--sp-3\); \}/);
    expect(css).toMatch(/@media \(min-width: 40rem\) \{[^}]*\.ld-actions \{[^}]*display: flex/);
    expect(css).toMatch(/@media \(min-width: 22rem\) \{[^}]*\.ld-strip \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
    expect(css).toMatch(/\.ld-v \{[^}]*font-size: var\(--type-head\);[^}]*font-weight: var\(--weight-bold\)/);
    // A ten-letter bold value word is wider than a cell on a 360 px phone: the values hyphenate on a phone and not from 48rem, where the cells have room; the separators are 8 px on a phone and 16 px from 48rem.
    expect(css).toMatch(/\.ld-v \{[^}]*hyphens: auto;/);
    expect(css).toMatch(/\.ld-strip \{ display: grid; gap: var\(--sp-2\);/);
    expect(css).toContain("@media (min-width: 22rem) { .ld-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); } .ld-strip li + li { padding-inline-start: var(--sp-2); border-inline-start: 1px solid var(--tone-stroke); } }");
    expect(css).toContain('@media (min-width: 48rem) { .ld-strip { gap: var(--sp-4); } .ld-strip li + li { padding-inline-start: var(--sp-4); } .ld-v { hyphens: manual; } }');
    expect(css).toMatch(/\.ld-k \{[^}]*font-size: var\(--type-secondary\)/);
    expect(css).toMatch(/\.ld-live-title \{[^}]*font-size: var\(--type-secondary\);[^}]*font-weight: var\(--weight-bold\)/);
    expect(css).toMatch(/\.ld-steps a \{ display: inline-flex; align-items: center; min-height: var\(--target\); \}/);
    expect(css).not.toContain('.kicker');
    // Every hover rule sits under (hover: hover); press feedback under (hover: none) (R-D4).
    const hovers = css.split('\n').filter((line) => line.includes(':hover'));
    expect(hovers.length).toBeGreaterThan(0);
    for (const line of hovers) expect(line, line).toContain('@media (hover: hover)');
    expect(css).not.toMatch(/\dvh\b/);
    expect(css).not.toContain('!important');
    expect(css).not.toContain('ld-domains');
  });

  it('landing.ts boots the page like every other entry (language toggle, sprite, theme) and keeps the signage sheet', () => {
    const entry = read('app/src/entries/landing.ts');
    expect(entry).toContain("import { bootPage } from '../boot';");
    expect(entry).toContain("bootPage({ page: 'landing' })");
    expect(entry).not.toContain('createThemeController(');
    expect(entry).toContain("import '../ui/signage.css';");
  });

  it('/izvori carries the placeholder and no inline script', () => {
    const html = read('app/izvori/index.html');
    expect(html).toContain('<!--IZVORI-->');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
  it('every prose page has a skip link, the accent wordmark, one h1 and the shared six-link footer, the current page marked', () => {
    for (const [path, current] of [
      ['app/izvori/index.html', '/izvori/'],
      ['app/privatnost/index.html', '/privatnost/'],
      ['app/pristupacnost/index.html', '/pristupacnost/'],
    ] as const) {
      const html = read(path);
      // No inline style or script (CSP: script-src 'self'; the palette lives in tokens.css, not a <style> tag).
      expect(html, path).not.toContain('<style>');
      expect(html, path).not.toMatch(/<script(?![^>]*\bsrc=)/);
      // One h1: the page's one heading landmark.
      expect((html.match(/<h1\b/g) ?? []).length, path).toBe(1);
      // A skip link, as the landing page has, that actually lands on the page (past the repeated brand line).
      const skip = html.match(/<a class="skip-link" href="#([\w-]+)">([^<]+)<\/a>/);
      expect(skip, path).toBeTruthy();
      expect(html, path).toContain(`id="${skip![1]}"`);
      // The wordmark, its "?" in the accent span, same markup as /hitno and /open/.
      expect(html, path).toContain('Kaj ima<span class="mark">?</span>');
      // The shared footer set, in order, the current page marked for assistive technology.
      for (const href of ['/hitno', '/s/', '/izvori/', '/open/', '/privatnost/', '/pristupacnost/']) {
        expect(html, `${path} ${href}`).toContain(`href="${href}"`);
      }
      expect(html, path).toContain(`href="${current}" aria-current="page"`);
      // The language toggle is dropped until the prose is translated (lang="hr" stays literal).
      expect(html, path).not.toContain('data-testid="lang-slot"');
      expect(html, path).toContain('<html lang="hr">');
    }
  });
  it('/privatnost lists the nine privacy points and no inline script', () => {
    const html = read('app/privatnost/index.html');
    for (let i = 1; i <= 9; i += 1) expect(html).toContain(`id="tocka-${i}"`);
    expect(html).toContain('U aplikaciji ne pohranjujemo IP adresu, korisnički agent ni trajni identifikator posjetitelja.');
    expect(html).not.toContain('tile.openstreetmap.org');
    expect(html).toContain('učitavaju se s iste domene');
    expect(html).toContain('Zaslon i telefon smiju biti na istom Wi-Fiju.');
    // Public since 14 September 2026: no Access login, the screen quota keyed by network.
    expect(html).not.toContain('Cloudflare Access');
    expect(html).toContain('Stvaranje zaslona je javno, bez prijave.');
    expect(html).toContain('sažetak mrežne adrese');
    expect(html).toContain('nema prijave ni autentikacijskog kolačića');
    expect(html).toContain('Repozitorij prototipa trenutačno je privatan');
    // Every browser-stored value, named (the data token is new in this wave).
    expect(html).toContain('token za nastavak sesije i token kojim ta sesija dohvaća podatke');
    expect(html).toContain('U localStorage ostaju tema, jezik i odabir laganog prikaza');
    expect(html).toContain('zaokruženi na 5, a ćelije s manje od 10 presavijene u „ostalo“');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
  it('/pristupacnost carries the deviation clause verbatim from the spec', () => {
    const html = read('app/pristupacnost/index.html');
    expect(html).toContain(DEVIATION);
    expect(html).toContain('sigurnosni sloj /hitno radi bez skeniranja i bez ograničenja trajanja');
    expect(html).toContain('Posljednji otvoreni sloj čuva se lokalno u kartici i vraća pri sljedećem skeniranju.');
    expect(html).not.toContain('kvaliteta zraka');
    expect(html).not.toContain('izvorni kod objavljen');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
});
