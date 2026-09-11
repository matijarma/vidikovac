import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const DEVIATION =
  'Odstupanje: vremensko ograničenje sesije. Prikaz nadzorne ploče traje najviše 10 minuta po skeniranju i ne može se produljiti, isključiti ni prilagoditi (WCAG 2.2, kriterij uspješnosti 2.2.1 Prilagodljivo vrijeme).';

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
    expect(html).toContain('otvoren je svima, bez skeniranja i bez ograničenja trajanja');
    for (const href of ['/hitno', '/s/', '/izvori/', '/open/', '/privatnost/', '/pristupacnost/']) {
      expect(html, href).toContain(`href="${href}"`);
    }
    // How to find a screen at all, in one sentence.
    expect(html).toContain('priđi mu, skeniraj kod kamerom ili upiši osam slova');
    // The body font is the one the product actually ships (fonts.css).
    expect(html).not.toContain('Inter');
    expect(html).toContain("'Manrope'");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).toContain('id="health"');
  });
  it('/izvori carries the placeholder and no inline script', () => {
    const html = read('app/izvori/index.html');
    expect(html).toContain('<!--IZVORI-->');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
  it('/privatnost lists the nine privacy points and no inline script', () => {
    const html = read('app/privatnost/index.html');
    for (let i = 1; i <= 9; i += 1) expect(html).toContain(`id="tocka-${i}"`);
    expect(html).toContain('Ne pohranjujemo IP adresu, korisnički agent, identifikator uređaja, kolačić ni koordinate.');
    // R-58: the map tile request is the single third-party call, and the list
    // view carries the same data without it.
    expect(html).toContain('tile.openstreetmap.org');
    expect(html).toContain('jedini poziv izvan ovog poslužitelja');
    // Every browser-stored value, named (the data token is new in this wave).
    expect(html).toContain('token za nastavak sesije i token kojim ta sesija dohvaća podatke');
    expect(html).toContain('U localStorage ostaju samo dvije postavke prikaza, tema i jezik');
    expect(html).toContain('zaokruženi na 5, a ćelije s manje od 10 presavijene u „ostalo”');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
  it('/pristupacnost carries the deviation clause verbatim from the spec', () => {
    const html = read('app/pristupacnost/index.html');
    expect(html).toContain(DEVIATION);
    expect(html).toContain('(1) sigurnosni sloj /hitno dostupan je svima, bez skeniranja i bez ograničenja trajanja;');
    expect(html).toContain('raspored panela čuva se lokalno u pregledniku i vraća pri sljedećem skeniranju.');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
});
