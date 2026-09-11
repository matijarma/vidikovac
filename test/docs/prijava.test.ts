import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
  it('has one section per Prilog 1 criterion in the 2026 order with the points stated', () => {
    const order = [
      '### 6.1 Dosadašnje iskustvo prijavitelja u razvojnim ili istraživačkim programima (0–10 bodova)',
      '### 6.2 Kapacitet prijavitelja za provedbu projekta (0–10 bodova)',
      '### 6.3 Tehnička izvedivost (0–10 bodova)',
      '### 6.4 Društvena korist (0–30 bodova)',
      '### 6.5 Inovativnost (0–20 bodova)',
      '### 6.6 Konačni proizvod pod licencom otvorenog koda ili u javnom dobru (0–10 bodova)',
      '### 6.7 Kvaliteta financijskog plana i obrazloženje troškova (0–10 bodova)',
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
