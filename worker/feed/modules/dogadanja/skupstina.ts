import type { FetchContext } from '../../schema';
import { decodeEntities, stripTags } from '../../html';
import { parseHrDate, type Precision } from '../../hr-date';

// The Assembly (skupstina.zagreb.hr) publishes no RSS and no API for its
// sessions: this reads the "Rokovnik sjednica" schedule listing for the
// calendar date and the organising body, then follows each dated row's own
// link to its session page for the time of day, the venue and the materials
// (invite/agenda) link. Verified against the real fixtures in
// test/fixtures/dogadanja/{skupstina-rokovnik,skupstina-sjednica}.html and
// their sources.json notes.
//
// Several rokovnik rows carry no <span><i class='news-date'> at all --
// committee sessions the page no longer dates -- and are skipped, never
// guessed at (see droppedCount below), the same "no date, no item" rule E2
// applies to Kulturpunkt. A row whose own session page can't be fetched is
// dropped the same way, so one broken link never costs the other rows.
//
// Every date, on both pages, is Croatian sentence prose, and this file reuses
// `parseHrDate` for all of it rather than inventing its own date grammar (see
// hr-date.ts's own header comment, which names this file by task). The one
// trap: the session page's `<div class='date-published'>` names only a day
// (no time), sitting *before* the actual invite sentence in the markup; fed
// to parseHrDate together, that earlier day-only mention would win as the
// first anchor and the real time would be lost. So it is stripped out before
// the page's prose is parsed -- see extractSessionProse.

export const SKUPSTINA_BASE_URL = 'https://skupstina.zagreb.hr';
export const SKUPSTINA_ROKOVNIK_URL = `${SKUPSTINA_BASE_URL}/rokovnik-sjednica/76`;
// The Assembly's YouTube channel, linked from every skupstina.zagreb.hr page's
// own nav ("Prijenos sjednice"). A fixed constant, never fetched: R-P5 keeps
// this off the disallowed `/feeds/videos.xml` path entirely -- linking is not
// crawling. There is exactly one channel, so this is not per-item data.
export const SKUPSTINA_YOUTUBE_URL = 'https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA';

export type SkupstinaCategory = 'sjednica-skupstine' | 'sjednica-odbora';

export interface SkupstinaEvent {
  id: string;
  title: string;
  /** The materials (invite/agenda) link when the session page states one, else the session page itself. */
  link: string;
  at: string;
  until?: string;
  data: {
    source: 'skupstina';
    organiser: string;
    category: SkupstinaCategory;
    precision: Precision;
    venue?: string;
    /** Set only for a plenary Assembly session -- see isPlenarySession. */
    live?: 'youtube';
  };
}

export interface SkupstinaResult {
  items: SkupstinaEvent[];
  /** Undated rokovnik rows, plus any dated row whose own session page could not be read -- dropped, never guessed. */
  droppedCount: number;
}

// One rokovnik row: <a href='URL' class='news-result'>[<span><i class='news-date'>DD.MM.YYYY.</i>TITLE</span>]</a>.
// The opening <a>'s full attribute text is captured as one group so href and
// class can appear in either order or with extra attributes between them --
// a CMS reflow's most likely shape of drift.
const ROW_PATTERN = /<a\b([^>]*\bclass=(["'])news-result\2[^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_PATTERN = /href=(["'])([^"']*)\1/i;
const LEADING_DATE_PATTERN = /^\d{1,2}\.\d{1,2}\.\d{4}\.?\s*/;

interface RokovnikRow {
  link: string;
  title: string;
  /** Baseline date from the schedule page, day precision -- overridden by a
   *  more specific reading of the session page's own prose when it parses. */
  at: string;
  precision: Precision;
}

function parseRokovnik(html: string, now: Date): { rows: RokovnikRow[]; droppedCount: number } {
  const rows: RokovnikRow[] = [];
  let droppedCount = 0;

  for (const block of html.matchAll(ROW_PATTERN)) {
    const hrefMatch = HREF_PATTERN.exec(block[1]);
    // stripTags turns "<span><i class='news-date'>14.09.2026.</i>15. sjednica ...</span>"
    // into "14.09.2026. 15. sjednica ..." -- one flat string with the date
    // first, exactly the shape parseHrDate is already proven against in
    // hr-date.test.ts. A row with no <span> at all strips to an empty
    // string, which parseHrDate correctly reads as "no date".
    const combined = decodeEntities(stripTags(block[3]));
    const hrDate = parseHrDate(combined, now);
    if (!hrefMatch || !hrDate) {
      droppedCount += 1;
      continue;
    }
    const title = combined.replace(LEADING_DATE_PATTERN, '').trim();
    if (!title) {
      droppedCount += 1;
      continue;
    }
    rows.push({
      link: new URL(hrefMatch[2], SKUPSTINA_BASE_URL).toString(),
      title,
      at: hrDate.startIso,
      precision: hrDate.precision,
    });
  }

  return { rows, droppedCount };
}

// "Poziv na 13. sjednicu Gradske skupštine Grada Zagreba" (a plenary session)
// or "15. sjednica Odbora za financije" (a committee session): in both real
// forms, the organiser is exactly the text after "sjednicu"/"sjednica",
// already in the grammatical case the CMS itself writes it in. This project
// keeps that case as printed rather than guessing a nominative form for
// committee names it hasn't seen -- see the task report's Rulings.
const PLENARY_TITLE_PATTERN = /^Poziv na \d+\.\s*sjednicu\s+(.+)$/i;
const COMMITTEE_TITLE_PATTERN = /^\d+\.\s*sjednica\s+(.+)$/i;
// The one real distinguishing signal the two saved rokovnik rows actually
// carry: a plenary session's title names the Assembly itself ("Gradske
// skupštine Grada Zagreba"), a committee session's does not. Real-world
// practice is that only plenary sessions are broadcast, which is exactly
// what this proxies -- see the task report's Rulings for why this reads
// "the session page says it is streamed" more reliably than the static
// YouTube nav link, which is identical chrome on every page of this site.
const PLENARY_SESSION_PATTERN = /gradsk[a-zščžćđ]*\s+skupštin/i;

function organiserFromTitle(title: string): string {
  const plenary = PLENARY_TITLE_PATTERN.exec(title);
  if (plenary) return plenary[1].trim();
  const committee = COMMITTEE_TITLE_PATTERN.exec(title);
  if (committee) return committee[1].trim();
  return title;
}

function isPlenarySession(title: string): boolean {
  return PLENARY_SESSION_PATTERN.test(title);
}

// The session page's <div class="page-text">...<!--galerija--> block. The
// gallery HTML comment is the one stable landmark that closes this block on
// both saved fixtures regardless of the nested <div class='date-published'>
// closing its own tag first -- a naive "up to the next </div>" match would
// stop there instead. Not a general HTML parser (html.ts's own header says
// so): this targets exactly the one real template these two fixtures share.
const PAGE_TEXT_PATTERN = /<div\b[^>]*\bclass=(["'])page-text\1[^>]*>([\s\S]*?)<!--galerija-->/i;
const DATE_PUBLISHED_PATTERN = /<div\b[^>]*\bclass=(["'])date-published\1[^>]*>[\s\S]*?<\/div>/i;
const MATERIALS_LINK_PATTERN = /<a\b([^>]*)>\s*Poziv\s+na\s+sjednicu\s*<\/a>/i;
// "... s početkom u 9:00 sati u Staroj gradskoj vijećnici, ..." -- venue is
// simply everything after the recognised time phrase's "sati u ", to the end
// of the prose. This is not itself a date pattern (parseHrDate owns those);
// it only anchors on the same "sati" landmark parseHrDate's own time grammar
// already requires, which is present precisely when parseHrDate finds a time.
const VENUE_PATTERN = /\bsati\s+u\s+([\s\S]+)$/i;

function extractSessionProse(pageTextHtml: string): string {
  const withoutDatePublished = pageTextHtml.replace(DATE_PUBLISHED_PATTERN, ' ');
  return decodeEntities(stripTags(withoutDatePublished));
}

function extractMaterialsLink(pageTextHtml: string): string | null {
  const anchor = MATERIALS_LINK_PATTERN.exec(pageTextHtml);
  if (!anchor) return null;
  const href = HREF_PATTERN.exec(anchor[1]);
  return href ? href[2] : null;
}

function idFromLink(link: string): string {
  const match = /\/(\d+)\/?$/.exec(link);
  return match ? match[1] : link;
}

export async function fetchSkupstina(ctx: FetchContext): Promise<SkupstinaResult> {
  const rokovnikResponse = await ctx.fetch(SKUPSTINA_ROKOVNIK_URL);
  const rokovnikHtml = await rokovnikResponse.text();
  const now = ctx.now();
  const { rows, droppedCount: undatedCount } = parseRokovnik(rokovnikHtml, now);

  const items: SkupstinaEvent[] = [];
  let droppedCount = undatedCount;

  for (const row of rows) {
    let sessionHtml: string;
    try {
      const sessionResponse = await ctx.fetch(row.link);
      if (!sessionResponse.ok) throw new Error(`skupstina: ${sessionResponse.status} for ${row.link}`);
      sessionHtml = await sessionResponse.text();
    } catch {
      droppedCount += 1;
      continue;
    }

    const pageTextHtml = PAGE_TEXT_PATTERN.exec(sessionHtml)?.[2] ?? '';
    const materialsLink = extractMaterialsLink(pageTextHtml);
    const prose = extractSessionProse(pageTextHtml);
    const hrDate = parseHrDate(prose, now);
    const venue = VENUE_PATTERN.exec(prose)?.[1]?.trim();
    const plenary = isPlenarySession(row.title);

    items.push({
      id: `skupstina:${idFromLink(row.link)}`,
      title: row.title,
      link: materialsLink ?? row.link,
      at: hrDate?.startIso ?? row.at,
      ...(hrDate?.endIso ? { until: hrDate.endIso } : {}),
      data: {
        source: 'skupstina',
        organiser: organiserFromTitle(row.title),
        category: plenary ? 'sjednica-skupstine' : 'sjednica-odbora',
        precision: hrDate?.precision ?? row.precision,
        ...(venue ? { venue } : {}),
        ...(plenary ? { live: 'youtube' as const } : {}),
      },
    });
  }

  return { items, droppedCount };
}
