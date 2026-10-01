import { describe, expect, it } from 'vitest';
import { beatOf, filterNews, fold, isLive, jaccard, relevance, titleWords, zagrebHour, type NewsItem } from '../../scripts/snimka/news-filter';

/** Zagreb wall time of the strike week (CEST). */
const z = (day: number, hh: number, mm = 0): number => Date.UTC(2026, 8, day, hh - 2, mm) / 1000;
let n = 0;
const item = (over: Partial<NewsItem>): NewsItem => ({
  outlet: 'jutarnji', title: 'Naslov', link: `https://www.jutarnji.hr/vijesti/zagreb/clanak-${++n}`, pubSec: z(28, 8), categories: ['Zagreb'], text: '', ...over,
});

describe('the press filter', () => {
  it('folds Croatian letters so one pattern matches every spelling', () => {
    expect(fold('Štrajk ZET-a: Zagrepčani čekaju, đaci ŽURE')).toBe('strajk zet-a: zagrepcani cekaju, daci zure');
  });

  it('keeps strike or transport words with a Zagreb anchor, outside sport, world and crime', () => {
    expect(relevance(item({ title: 'Štrajk ZET-a: tramvaji stoje' })).relevant).toBe(true);
    expect(relevance(item({ title: 'Zagrepčani sjeli na bicikle', text: '' })).relevant).toBe(true);
    // A transport word without Zagreb.
    expect(relevance(item({ title: 'Autobus sletio s ceste kod Splita', categories: ['Hrvatska'], link: 'https://www.jutarnji.hr/vijesti/hrvatska/x-1' })).relevant).toBe(false);
    // Zagreb without a strike or transport word.
    expect(relevance(item({ title: 'Zagreb dobiva novi park' })).relevant).toBe(false);
    // Sport, world and crime are out by category or by the link's path.
    expect(relevance(item({ title: 'Dinamo putuje autobusom bez štrajka ZET-a', categories: ['Nogomet'] })).relevant).toBe(false);
    expect(relevance(item({ outlet: 'vecernji', title: 'Štrajk u Zagrebu i navijači', categories: [], link: 'https://www.vecernji.hr/sport/strajk-navijaci-1999' })).relevant).toBe(false);
    expect(relevance(item({ title: 'Štrajk tramvajaca u Parizu', categories: ['Svijet'] })).relevant).toBe(false);
    expect(relevance(item({ title: 'Uhićen vozač autobusa u Zagrebu', categories: ['Crna kronika'] })).relevant).toBe(false);
    // The description counts for relevance, the title for the score.
    const quiet = relevance(item({ title: 'Kako je izgledao jučerašnji dan', text: 'Štrajk ZET-a u Zagrebu ušao je u drugi dan' }));
    const loud = relevance(item({ title: 'Štrajk ZET-a u Zagrebu ušao je u drugi dan' }));
    expect(quiet.relevant).toBe(true);
    expect(loud.score).toBeGreaterThan(quiet.score);
  });

  it('gives each item the first beat that fits its words and its time', () => {
    expect(beatOf(item({ title: 'Sutra kreće štrajk, Zagreb bez tramvaja', pubSec: z(27, 21) }))).toBe('najava');
    expect(beatOf(item({ title: 'Počeo štrajk: Zagreb jutros bez tramvaja', pubSec: z(28, 6) }))).toBe('pocetak');
    expect(beatOf(item({ title: 'Na ulicama samo jedan tramvaj', pubSec: z(28, 9) }))).toBe('jedan-tramvaj');
    expect(beatOf(item({ title: 'Redovi za BAJS bicikle', pubSec: z(28, 9) }))).toBe('bajs');
    expect(beatOf(item({ title: 'Uber i Bolt: potražnja skočila', pubSec: z(28, 10) }))).toBe('taksi');
    expect(beatOf(item({ title: 'Volonteri voze pacijente do bolnica', pubSec: z(28, 11) }))).toBe('volonteri');
    expect(beatOf(item({ title: 'Učenici kasne u škole', pubSec: z(28, 8) }))).toBe('skole');
    expect(beatOf(item({ title: 'Sud odbio privremenu zabranu štrajka', pubSec: z(29, 12) }))).toBe('sud-privremeno');
    expect(beatOf(item({ title: 'Uspostavljena linija 228 do Rebra', pubSec: z(29, 10) }))).toBe('linija-228');
    expect(beatOf(item({ title: 'Sud: štrajk u ZET-u je nezakonit', pubSec: z(30, 11, 15) }))).toBe('presuda');
    expect(beatOf(item({ title: 'Tramvaji se vraćaju na ulice', pubSec: z(30, 18, 30) }))).toBe('povratak');
    // The same words outside a beat's window fall to the next beat that fits.
    expect(beatOf(item({ title: 'Štrajk se nastavlja, počinje i sutra', pubSec: z(29, 21) }))).toBe('drugi-dan');
    expect(beatOf(item({ title: 'Zagrebački holding: smeće se ne odvozi', pubSec: z(29, 9) }))).toBe('holding');
    expect(beatOf(item({ title: 'Nešto sasvim drugo', pubSec: z(29, 9) }))).toBeNull();
  });

  it('measures near-duplicate titles by their words', () => {
    expect(jaccard(titleWords('Štrajk ZET-a: tramvaji stoje u Zagrebu'), titleWords('Štrajk ZET-a, tramvaji stoje u Zagrebu!'))).toBe(1);
    expect(jaccard(titleWords('Štrajk ZET-a: tramvaji stoje'), titleWords('BAJS bicikli nestali sa stanica'))).toBe(0);
    expect(isLive({ title: 'UŽIVO Štrajk ZET-a, drugi dan' })).toBe(true);
    expect(isLive({ title: 'Štrajk ZET-a, drugi dan' })).toBe(false);
  });

  it('merges near-duplicates within six hours to the earliest and keeps a live blog once a day per outlet', () => {
    const a = item({ title: 'Štrajk ZET-a: tramvaji stoje u Zagrebu', pubSec: z(28, 7) });
    const b = item({ outlet: 'n1', title: 'Štrajk ZET-a, tramvaji stoje u Zagrebu', pubSec: z(28, 8), link: 'https://n1info.hr/vijesti/a/', categories: ['Vijesti'] });
    const late = item({ title: 'Štrajk ZET-a: tramvaji stoje u Zagrebu', pubSec: z(28, 14) });
    const live1 = item({ title: 'UŽIVO Štrajk ZET-a u Zagrebu', pubSec: z(28, 9) });
    const live2 = item({ title: 'UŽIVO Drugi sat štrajka ZET-a u Zagrebu, autobusi stoje', pubSec: z(28, 10, 30) });
    const live3 = item({ title: 'UŽIVO Štrajk ZET-a u Zagrebu, novi dan', pubSec: z(29, 9) });
    const { pool } = filterNews([late, b, live2, a, live1, live3, a]);
    expect(pool.map((c) => c.link)).toEqual([a.link, live1.link, late.link, live3.link]);
    expect(pool[0].merged).toEqual([b.link]);
    expect(pool[1].merged).toEqual([live2.link]);
    expect(pool[0].pubSec).toBe(z(28, 7));
  });

  it('marks the first report of each beat, then keeps at most three per hour ten minutes apart', () => {
    const items = [0, 4, 12, 25, 40, 55].map((mm, i) =>
      item({ title: `Štrajk ZET-a u Zagrebu: vijest broj ${['jedan', 'dva', 'tri', 'četiri', 'pet', 'šest'][i]} ${'abcdef'[i].repeat(4)}`, pubSec: z(28, 9, mm) }));
    const bikes = item({ title: 'Zagrepčani uzeli BAJS bicikle', pubSec: z(28, 9, 30) });
    const bikes2 = item({ title: 'Opet nestali BAJS bicikli u Zagrebu na stanicama', pubSec: z(28, 11) });
    const { candidates } = filterNews([...items, bikes, bikes2]);
    const first = candidates.find((c) => c.link === bikes.link)!;
    expect(first.beat).toBe('bajs');
    expect(first.firstOfBeat).toBe(true);
    expect(candidates.find((c) => c.link === bikes2.link)!.firstOfBeat).toBe(false);
    const nine = candidates.filter((c) => c.selected && zagrebHour(c.pubSec) === z(28, 9));
    expect(nine.length).toBe(3);
    expect(nine.map((c) => c.link)).toContain(bikes.link);
    const times = nine.map((c) => c.pubSec).sort((x, y) => x - y);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(600);
    expect(candidates.find((c) => c.link === bikes2.link)!.selected).toBe(true);
  });
});
