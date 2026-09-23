import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Env } from '../../worker/env';
import { codeRotateSeconds, peerMinutes, sessionMinutes } from '../../worker/config';
import { CODE_EARLY_MS, CODE_GRACE_MS, CODE_LENGTH } from '../../worker/protocol';
import { QUAKE_WINDOW_MS } from '../../worker/hitno/select';
import { UPSTREAM_TIMEOUT_MS } from '../../worker/feed/http';
import { parseNotes, render } from '../../scripts/build-prijava.mjs';

const read = (p: string) => readFileSync(new URL(`../../docs/prijava/${p}`, import.meta.url), 'utf8');
const headingIndex = (md: string, heading: string) => {
  const i = md.indexOf(`\n${heading}\n`);
  if (i === -1) throw new Error(`heading not found: ${heading}`);
  return i;
};
const eur = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

describe('prijedlog-projekta.md', () => {
  const md = read('prijedlog-projekta.md');
  it('has the five mandatory item-8 headings in order', () => {
    const order = [
      '## 1. Popis funkcionalnosti',
      '## 2. Potencijalni profil korisnika',
      '## 3. Tip rješenja',
      '## 4. Obrazloženje interesa projekta za Grad Zagreb',
      '## 5. Popis otvorenih podataka koji bi se koristili',
    ].map((h) => headingIndex(md, h));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('has one section per Prilog 1 criterion, named as in Prilog 1, in order and with the points stated', () => {
    const order = [
      '### 6.1 Prethodno iskustvo prijavitelja u provedbi razvojnih ili istraživačkih programa (0–10 bodova)',
      '### 6.2 Kapacitet prijavitelja da kvalitetno provede predloženi program (0–10 bodova)',
      '### 6.3 Tehnička izvedivost predloženog programa (0–10 bodova)',
      '### 6.4 Društvena korist predloženog programa (0–30 bodova)',
      '### 6.5 Inovativnost predloženog programa (0–20 bodova)',
      '### 6.6 Konačni proizvod dostupan je pod licencom otvorenog koda ili u slobodnoj domeni (0–10 bodova)',
      '### 6.7 Kvaliteta financijskog plana i opravdanost troškova (0–10 bodova)',
    ].map((h) => headingIndex(md, h));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('never addresses the reader as Vi and uses the singular imperative in UI quotes', () => {
    expect(md).not.toMatch(/\bVi\b|\bVaš/);
    expect(md).toContain('Skeniraj');
  });
});

describe('obrazac-3-financijski-plan.md', () => {
  const md = read('obrazac-3-financijski-plan.md');
  const rows = md.split('\n').filter((l) => /^\| [1-5]\. /.test(l));
  const amounts = rows.map((l) => eur(l.split('|').map((s) => s.trim()).at(-2)!));
  it('has exactly the five rows of Obrazac 3 with the approved amounts', () => {
    expect(amounts).toEqual([6300, 11090, 1200, 320, 1090]);
  });
  it('sums to 20,000 EUR without VAT and keeps promotion at or above 5 percent', () => {
    const total = amounts.reduce((a, b) => a + b, 0);
    expect(total).toBe(20000);
    expect(amounts[2] / total).toBeGreaterThanOrEqual(0.05);
    expect(md).toContain('20.000,00');
    expect(md).toContain('bez PDV-a');
  });
  it('states the hourly formula and the 10.00 EUR alternative that still sums to 20,000', () => {
    expect(md).toContain('1.720');
    expect(md).toContain('12,60');
    expect(md).toContain('10,00');
    expect(md).toContain('5.000,00');
    expect(md).toContain('12.390,00');
  });
});

describe('plan-provedbe.md and rizici-i-odgovori.md', () => {
  it('has milestones M0 to M7 in order', () => {
    const md = read('plan-provedbe.md');
    const idx = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'].map((m) => {
      const i = md.indexOf(`\n### ${m} `);
      if (i === -1) throw new Error(m);
      return i;
    });
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('answers exactly eight committee objections, numbered in order', () => {
    const md = read('rizici-i-odgovori.md');
    const headings = md.match(/^### (\d)\. /gm) ?? [];
    expect(headings).toHaveLength(8);
    expect(headings.map((h) => Number(h.slice(4, 5)))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // The count in the opening line must follow the headings.
    expect(md).toContain('Osam prigovora');
  });
});

describe('prijedlog-projekta.md quotes the code', () => {
  const md = read('prijedlog-projekta.md');
  const env = {} as Env;
  it('session, share and rotation lengths come from config.ts', () => {
    expect(sessionMinutes(env)).toBe(10);
    expect(md).toContain('deset minuta');
    expect(peerMinutes(env)).toBe(5);
    expect(md).toContain('pet svježih minuta');
    expect(md).toContain(`rotira svakih ${codeRotateSeconds(env)} sekundi`);
  });
  it('code window and entropy come from protocol.ts', () => {
    expect(md).toContain(`od ${CODE_EARLY_MS / 1000} s prije do ${CODE_GRACE_MS / 1000} s nakon`);
    expect(md).toContain(`${CODE_LENGTH * 5} bita entropije`);
  });
  it('quake window and upstream timeout come from the worker', () => {
    expect(md).toContain(`posljednja ${QUAKE_WINDOW_MS / 3_600_000} sata`);
    expect(md).toContain(`rok dohvata od ${UPSTREAM_TIMEOUT_MS / 1000} sekundi`);
  });
});

// WP7 (23 September 2026, [O-75]): /prijava/ keeps the proposal exactly as submitted and adds
// one optional layer, off by default, of dated development notes since submission. The layer
// is rendered on the hosted page only, from docs/prijava/razvojne-biljeske.md, as one block at
// the top of <main>; everything else in the page is the markup the masters render without it.
describe('/prijava/: the submitted text and the development-notes layer', () => {
  const root = (p: string) => new URL(`../../${p}`, import.meta.url);
  const hosted = readFileSync(root('app/prijava/index.html'), 'utf8');
  const submitted = read('prijedlog-projekta.html');
  const LAYER = /<div class="notes" id="biljeske" data-prijava-notes-root>[\s\S]*?<\/aside>\s*<\/div>\s*/;
  const SCRIPTS = /<script>[\s\S]*?<\/script>/g;
  const article = (html: string) => {
    const m = /<main class="doc" id="sadrzaj">([\s\S]*?)<\/main>/.exec(html);
    if (!m) throw new Error('no <main id="sadrzaj">');
    return m[1];
  };
  const text = (html: string) => html.replace(SCRIPTS, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('the committed page and script are exactly what the build renders, layer included', () => {
    const built = render();
    expect(built.warnings).toEqual([]);
    // Compared as booleans: a failing diff of a 1.3 MB page helps nobody; rebuild with `npm run build:prijava`.
    expect(built.hosted === hosted, 'app/prijava/index.html is stale or hand-edited').toBe(true);
    expect(readFileSync(root('app/prijava/prijava.js'), 'utf8')).toBe(read('src/prijava.js'));
  });

  it('the article minus the layer is, byte for byte, the article rendered from prijedlog-projekta.md without it', () => {
    const page = article(hosted);
    expect(page).toMatch(LAYER);
    const rest = page.replace(LAYER, '');
    expect(rest).not.toMatch(/prijava-notes|biljeske|razvojne bilješke/i);
    expect(rest === article(render({ notes: false }).hosted)).toBe(true);
  });

  it('the article minus the layer is the article of the submitted self-contained file', () => {
    // The file inlines a figure's small script that the hosted page's CSP drops; nothing else differs.
    const rest = article(hosted).replace(LAYER, '');
    expect(rest === article(submitted).replace(SCRIPTS, '')).toBe(true);
    expect(text(rest)).toBe(text(article(submitted)));
    expect(submitted).not.toMatch(/prijava-notes|razvojne-biljeske|Razvojne bilješke/);
  });

  it('ships the layer hidden, the button unpressed and labelled, and the page unindexed', () => {
    const button = /<button [^>]*data-testid="prijava-notes"[^>]*>([^<]*)<\/button>/.exec(hosted);
    expect(button?.[0]).toContain('type="button"');
    expect(button?.[0]).toContain('aria-pressed="false"');
    expect(button?.[0]).toContain('aria-controls="biljeske-sloj"');
    expect(button?.[1]).toBe('Razvojne bilješke od predaje');
    const aside = /<aside [^>]*data-testid="prijava-notes-layer"[^>]*>/.exec(hosted)?.[0] ?? '';
    expect(aside).toMatch(/\shidden(?=[\s>])/);
    expect(aside).toContain('id="biljeske-sloj"');
    expect(aside).toContain('aria-labelledby="biljeske-h"');
    expect(hosted).toContain('<h2 class="notes-title" id="biljeske-h">Bilješke o razvoju nakon predaje, nisu dio predanog prijedloga</h2>');
    expect(hosted.match(/data-testid="prijava-notes(?:-layer)?"/g)).toHaveLength(2);
    expect(hosted).toContain('<meta name="robots" content="noindex">');
  });

  it('dates every entry of razvojne-biljeske.md and links it to the record in the repository', () => {
    const md = read('razvojne-biljeske.md');
    const { intro, entries } = parseNotes(md);
    expect(intro.length).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const e of entries) {
      expect(e.iso, `entry "${e.date}" has no date`).toMatch(/^2026-\d\d-\d\d$/);
      expect(e.title.length, `entry ${e.date} has no title`).toBeGreaterThan(0);
      const links = [...e.paragraphs.join(' ').matchAll(/\]\((https:\/\/github\.com\/matijarma\/vidikovac\/blob\/main\/([^)]+))\)/g)];
      expect(links.length, `entry ${e.date} has no link to the record`).toBeGreaterThan(0);
    }
    const isos = entries.map((e) => e.iso as string);
    expect([...isos].sort()).toEqual(isos);
    // House style of a Croatian document the owner reads: no em dash, no ellipsis, no "zid".
    expect(md).not.toMatch(/—|…| -- /);
    expect(md).not.toMatch(/(?<![\p{L}])zid/iu);
  });
});
