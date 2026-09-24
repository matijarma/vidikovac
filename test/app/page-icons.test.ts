// Every page named an icon nowhere, so each first load asked for /favicon.ico and got a 404 (Lighthouse best
// practices 96 on the landing phone and the wall, lane/v-lh P8). The icon is the product's own compact mark, the
// one the phone's header shows on a narrow screen (dashboard.css: the wordmark's text folds away and the "?"
// stays, in the action colour): a "?" in --palette-light-accent (--tone-action-brand), lighter by night. /favicon.ico carries the same
// mark for whatever asks for it without reading the page (the protected /prijava/, the Worker's pages, bots).
// And the hero's two captures state their size on the dark <source> as well as on the <img>.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..', '..', 'app');
const read = (...parts: string[]): string => readFileSync(join(APP, ...parts), 'utf8');
const PAGES = ['index.html', 'd/index.html', 's/index.html', 'kiosk/index.html', 'izvori/index.html', 'privatnost/index.html', 'pristupacnost/index.html'];

describe('the page icon', () => {
  const svg = read('public', 'favicon.svg');
  const tokens = read('src', 'ui', 'tokens.css');
  it('is a small SVG in the action colour of both palettes', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(Buffer.byteLength(svg)).toBeLessThan(1024);
    const light = /--palette-light-accent:\s*(#[0-9a-f]{6})/i.exec(tokens)![1]!;
    const dark = /--palette-dark-accent:\s*(#[0-9a-f]{6})/i.exec(tokens)![1]!;
    expect(svg).toContain(light);
    expect(svg).toMatch(new RegExp(`@media \\(prefers-color-scheme:\\s*dark\\)\\{[^}]*${dark}`));
    expect(svg).not.toMatch(/<text|<image|href=/);
  });
  it.each(PAGES)('%s names it in its head', (page) => {
    const head = read(page).split('</head>')[0]!;
    expect(head).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  });
  it('/favicon.ico is a one-image ICO holding a 32 px PNG', () => {
    const ico = readFileSync(join(APP, 'public', 'favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect([ico[6], ico[7]]).toEqual([32, 32]);
    const offset = ico.readUInt32LE(18);
    expect(ico.subarray(offset, offset + 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
    expect(ico.length).toBeLessThan(4096);
  });
});

describe('the hero captures state their size on every candidate', () => {
  const html = read('index.html');
  const hero = html.slice(html.indexOf('<figure class="ld-hero-figure">'), html.indexOf('</figure>'));
  it.each([['kiosk', '1920', '1080'], ['phone', '390', '844']])('%s: the dark <source> and the <img> both say %sx%s', (capture, width, height) => {
    const picture = hero.slice(hero.indexOf(`<picture data-capture="${capture}">`), hero.indexOf('</picture>', hero.indexOf(`<picture data-capture="${capture}">`)));
    expect(picture).toMatch(new RegExp(`<source [^>]*width="${width}" height="${height}"`));
    expect(picture).toMatch(new RegExp(`<img [^>]*width="${width}" height="${height}"`));
  });
});
