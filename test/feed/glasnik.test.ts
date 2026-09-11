import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GLASNIK_ACT_URL,
  GLASNIK_API,
  fetchGlasnik,
  newestIssue,
  parseAkti,
  parseCroatianDate,
  repairMojibake,
} from '../../worker/feed/modules/glasnik';

const sifarnici = JSON.parse(readFileSync(new URL('../fixtures/glasnik_sifarnici.json', import.meta.url), 'utf8'));

describe('repairMojibake', () => {
  it('re-decodes UTF-8 that was read as Latin-1', () => {
    // 'ž' is C5 BE; read byte by byte it shows up as 'Å¾'.
    expect(repairMojibake('SluÅ¾beni glasnik Grada Zagreba')).toBe('Službeni glasnik Grada Zagreba');
    expect(repairMojibake('Odluka o proÄiÅ¡Äenom tekstu')).toBe('Odluka o pročišćenom tekstu');
  });
  it('leaves correct Croatian and plain ASCII alone', () => {
    expect(repairMojibake('Odluka o obavljanju dimnjačarskih poslova')).toBe('Odluka o obavljanju dimnjačarskih poslova');
    expect(repairMojibake('Odluka o proracunu')).toBe('Odluka o proracunu');
    expect(repairMojibake('')).toBe('');
  });
  it('returns the input when the bytes are not valid UTF-8', () => {
    expect(repairMojibake('cijena 25  kn')).toBe('cijena 25  kn');
  });
});

describe('parseCroatianDate', () => {
  it('reads a date written in words', () => {
    expect(parseCroatianDate('Broj 29 od 7. rujna 2026.')).toBe('2026-09-06T22:00:00.000Z');
    expect(parseCroatianDate('Broj 1 od 5. siječnja 2026.')).toBe('2026-01-04T23:00:00.000Z');
    expect(parseCroatianDate('Broj 12')).toBeUndefined();
  });
});

describe('newestIssue', () => {
  it('finds the highest issue number of the newest active year', () => {
    const issue = newestIssue(sifarnici);
    expect(issue).toEqual({
      yearId: '0e3096c4-c1d6-4774-937d-8dd059de5235',
      year: '2026',
      issueId: '95b72735-70a6-4704-9ee0-f2a106798a43',
      issueLabel: 'Broj 29 od 7. rujna 2026.',
      issueNumber: 29,
      publishedAt: '2026-09-06T22:00:00.000Z',
    });
  });
  it('returns null when the gateway answers nothing usable', () => {
    expect(newestIssue(null)).toBeNull();
    expect(newestIssue({ data: { godine: [], brojevi: [] } })).toBeNull();
  });
});

describe('parseAkti', () => {
  const issue = newestIssue(sifarnici)!;

  it('turns acts into items with a deep link and repaired titles', () => {
    const payload = parseAkti(
      {
        servis: 'Čitanje akata',
        data: [
          { id: 'a1b2', naziv: 'Odluka o proraÄunu Grada Zagreba' },
          { id: 'c3d4', naziv: 'Zaključak o davanju suglasnosti' },
          { naziv: 'Bez identifikatora' },
        ],
      },
      issue,
    );
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({
      id: 'a1b2',
      kind: 'act',
      title: 'Odluka o proračunu Grada Zagreba',
      link: `${GLASNIK_ACT_URL}a1b2`,
      at: '2026-09-06T22:00:00.000Z',
      data: { issue: 'Broj 29 od 7. rujna 2026.', issueNumber: 29, year: '2026' },
    });
    expect(payload.sourceUpdatedAt).toBe('2026-09-06T22:00:00.000Z');
  });

  it('accepts the alternative envelopes and an empty answer', () => {
    expect(parseAkti({ data: { akti: [{ id: 'x', naslov: 'Pravilnik' }] } }, issue).items[0].title).toBe('Pravilnik');
    expect(parseAkti([{ id: 'y', naziv: 'Odluka' }], issue).items).toHaveLength(1);
    expect(parseAkti(null, issue).items).toEqual([]);
  });
});

describe('fetchGlasnik', () => {
  it('reads the code lists, then posts for the acts of the newest issue', async () => {
    const asked: { url: string; body?: string }[] = [];
    const payload = await fetchGlasnik({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url, init) => {
        asked.push({ url, body: init?.body as string | undefined });
        if (url.endsWith('sifarnici')) return new Response(JSON.stringify(sifarnici));
        return new Response(JSON.stringify({ data: [{ id: 'a1b2', naziv: 'Odluka' }] }));
      },
    });

    expect(asked[0].url).toBe(`${GLASNIK_API}sifarnici`);
    expect(GLASNIK_API).toBe('https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/');
    expect(asked[1].url).toBe(`${GLASNIK_API}akti`);
    expect(JSON.parse(asked[1].body ?? '{}')).toEqual({
      item: {
        godina: '0e3096c4-c1d6-4774-937d-8dd059de5235',
        broj: '95b72735-70a6-4704-9ee0-f2a106798a43',
        godinaOd: '',
        godinaDo: '',
        tekst: '',
        tip: 1,
      },
    });
    expect(payload.items).toHaveLength(1);
    expect(GLASNIK_ACT_URL).toBe('https://www1.zagreb.hr/sluzbeni-glasnik/#/app/akt/');
  });

  it('throws when no issue can be identified, so the cache layer can fall back', async () => {
    await expect(
      fetchGlasnik({
        now: () => new Date('2026-09-11T10:00:00.000Z'),
        fetch: async () => new Response(JSON.stringify({ data: { godine: [], brojevi: [] } })),
      }),
    ).rejects.toThrow(/glasnik/);
  });
});
