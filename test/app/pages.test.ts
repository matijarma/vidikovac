import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const DEVIATION =
  'Odstupanje: vremensko ograničenje sesije. Prikaz nadzorne ploče traje najviše 10 minuta po skeniranju i ne može se produljiti, isključiti ni prilagoditi (WCAG 2.2, kriterij uspješnosti 2.2.1 Prilagodljivo vrijeme).';

describe('vite multi-page inputs', () => {
  it('builds every page of the product', () => {
    const input = (config as { build?: { rollupOptions?: { input?: Record<string, string> } } }).build!.rollupOptions!.input!;
    expect(Object.keys(input).sort()).toEqual(['d', 'index', 'izvori', 'kiosk', 'prijava', 'pristupacnost', 'privatnost', 's', 'statistika'].sort());
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
  it('the landing communicates the working service, keeps public routes, and separates captures from data', () => {
    const html = read('app/index.html');
    expect(html).not.toContain('Prototip u izgradnji');
    expect(html).not.toContain('bit će otvoren');
    expect(html).not.toContain('Plaća se pažnjom');
    expect(html).toContain('Nitko ništa ne plaća, ni novcem ni pažnjom');
    expect(html).toContain('bez koda i bez ograničenja trajanja');
    for (const href of ['/hitno', '/s/', '/kiosk/', '/izvori/', '/open/', '/privatnost/', '/pristupacnost/', '/prijava/', '/statistika/']) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).toContain('href="/src/ui/tokens.css"');
    expect(html).not.toContain('<style>');
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain('Kaj ima?');
    expect(html).not.toContain('Vidikovac');
    expect(html).not.toMatch(/<canvas|panorama|meander|SL\. \d/);
    expect(html).toContain('data-testid="live-strip"');
    expect(html).toContain('data-live="weather"');
    expect(html).toContain('data-live="safety"');
    expect(html).toContain('Podaci na snimkama nisu trenutačno stanje.');
    expect(html).toContain('id="health"');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).toContain('src="/src/entries/landing.ts"');
    expect(html).not.toContain('/src/health.ts');
  });
  it('landing style is local, responsive, and progressively enhances a complete story', () => {
    const css = read('app/src/ui/landing.css');
    expect(css).toContain('.ld-page');
    expect(css).toContain("data-story-motion='1'");
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('position: sticky');
    expect(css).toContain('@media (min-width: 48rem)');
    expect(css).toContain('@media (hover: hover)');
    expect(css).toContain('@media (hover: none)');
    expect(css).not.toContain('background-clip: text');
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('!important');
  });
  it('landing boots the shared locale/theme system and never provisions or redeems', () => {
    const entry = read('app/src/entries/landing.ts');
    expect(entry).toContain("import { bootPage } from '../boot';");
    expect(entry).toContain("page: 'landing'");
    expect(entry).not.toContain('createThemeController(');
    expect(entry).toContain("import '../ui/signage.css';");
    expect(entry).not.toContain('/api/screens');
    expect(entry).not.toContain('/api/scan');
    expect(entry).not.toContain('mountDashboard');
    expect(entry).toContain('if (!lightweight)');
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
      expect(html, path).not.toContain('<style>');
      expect(html, path).not.toMatch(/<script(?![^>]*\bsrc=)/);
      expect((html.match(/<h1\b/g) ?? []).length, path).toBe(1);
      const skip = html.match(/<a class="skip-link" href="#([\w-]+)">([^<]+)<\/a>/);
      expect(skip, path).toBeTruthy();
      expect(html, path).toContain(`id="${skip![1]}"`);
      expect(html, path).toContain('Kaj ima<span class="mark">?</span>');
      for (const href of ['/hitno', '/s/', '/izvori/', '/open/', '/privatnost/', '/pristupacnost/']) {
        expect(html, `${path} ${href}`).toContain(`href="${href}"`);
      }
      expect(html, path).toContain(`href="${current}" aria-current="page"`);
      expect(html, path).not.toContain('data-testid="lang-slot"');
      expect(html, path).toContain('<html lang="hr">');
      // D-F19: the chrome sits outside main, as on / and /statistika: the wordmark in the banner, the six links in the contentinfo.
      const [head, rest] = html.split('<main class="page">');
      expect(rest, path).toBeDefined();
      expect(head, path).toMatch(/<header class="page-head">\s*<p class="page-nav"><a class="page-brand" href="\/">/);
      const [inMain, after] = rest!.split('</main>');
      expect(inMain, path).not.toContain('aria-label="Stranice"');
      expect(inMain, path).toMatch(/<h1\b/);
      expect(after, path).toMatch(/^\s*<footer class="page-foot">\s*<nav class="page-nav" aria-label="Stranice">/);
    }
  });
  it('/statistika is a prose-family page: skip link, wordmark, one h1, the six-link footer, prose that stands without JS', () => {
    const html = read('app/statistika/index.html');
    expect(html).toContain('<html lang="hr">');
    expect(html).not.toContain('<style>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain('<a class="skip-link" href="#sadrzaj">');
    expect(html).toContain('id="sadrzaj"');
    expect(html).toContain('Kaj ima<span class="mark">?</span>');
    expect(html).toContain('<link rel="stylesheet" href="/src/ui/tokens.css">');
    expect(html).toContain('src="/src/entries/statistika.ts"');
    for (const href of ['/hitno', '/s/', '/izvori/', '/open/', '/privatnost/', '/pristupacnost/']) expect(html, href).toContain(`href="${href}"`);
    // The explanation is static: the threshold rule, the six fields and the City's terms read without the numbers.
    expect(html).toContain('Pravilo praga: nijedan broj manji od 10');
    expect(html).toContain('<dt>dimenzija 2</dt>');
    expect(html).toContain('pod trajnom, besplatnom i neisključivom licencom s pravom objave');
    expect(html).toContain('<noscript>');
    for (const id of ['ukratko', 'kako-brojimo', 'koristenje', 'za-grad', 'izvori', 'tramvaji', 'otvoreno']) {
      expect(html, id).toContain(`id="${id}"`);
      expect(html, id).toContain(`href="#${id}"`);
    }
    // Counting what is shown here would be a counter the privacy page does not list: the page makes no beacon call.
    expect(read('app/src/entries/statistika.ts')).not.toMatch(/sendBeacon|\/api\/(?!statistika)/);
  });
  it('/privatnost lists the ten privacy points and no inline script', () => {
    const html = read('app/privatnost/index.html');
    for (let i = 1; i <= 10; i += 1) expect(html).toContain(`id="tocka-${i}"`);
    expect(html).toContain('Voditelj obrade je Aning Film d.o.o.');
    expect(html).toContain('evaluation (aktivnosti privremenih zaslona');
    expect(html).toContain('U aplikaciji ne pohranjujemo IP adresu, korisnički agent ni trajni identifikator posjetitelja.');
    expect(html).not.toContain('tile.openstreetmap.org');
    expect(html).toContain('učitavaju se s iste domene');
    expect(html).toContain('Zaslon i telefon smiju biti na istom Wi-Fiju.');
    expect(html).not.toContain('Cloudflare Access');
    expect(html).toContain('Stvaranje zaslona je javno, bez prijave.');
    expect(html).toContain('sažetak mrežne adrese');
    expect(html).toContain('nema prijave ni autentikacijskog kolačića');
    expect(html).toContain('Izvorni kod prototipa javan je od 15. rujna 2026.');
    expect(html).toContain('token za nastavak sesije, token kojim ta sesija dohvaća podatke');
    expect(html).toContain('U localStorage ostaju tema, jezik, lagani prikaz, spremljene linije, stajališta i mjesta te prekidači isticanja u aplikaciji');
    expect(html).toContain('Tekst pretrage i filtri ostaju u sessionStorage');
    expect(html).toContain('pri izričitom prikazivanju šalje se samo odabrani javni pogled');
    expect(html).toContain('zaokruženi na 5, a ćelije s manje od 10 presavijene u „ostalo“');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
  it('/pristupacnost carries the deviation clause verbatim from the spec', () => {
    const html = read('app/pristupacnost/index.html');
    expect(html).toContain(DEVIATION);
    expect(html).toContain('Sigurnosni sloj /hitno radi javno, bez skeniranja i bez ograničenja trajanja');
    expect(html).toContain('Posljednji otvoreni sloj čuva se lokalno u kartici i vraća pri sljedećem skeniranju.');
    expect(html).not.toContain('kvaliteta zraka');
    expect(html).not.toContain('izvorni kod objavljen');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
});
