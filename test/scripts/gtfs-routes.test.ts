import { describe, expect, it } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRoutesIndex,
  extractEntry,
  main,
  parseCsv,
  readZipEntries,
  routesFromZip,
} from '../../scripts/gtfs-routes.mjs';

interface ZipInput {
  name: string;
  data: string;
  method: 0 | 8;
}

/** Builds a valid zip (local headers, central directory, EOCD) with no library. */
function makeZip(files: ZipInput[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.data);
    const packed = f.method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags: no data descriptor
    lv.setUint16(8, f.method, true);
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0, true); // date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);
    local.set(packed, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, f.method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// Header and three rows exactly in the shape ZET publishes (verified 11 Sept 2026),
// plus one row with an escaped quote and a comma inside a quoted field.
const ROUTES_TXT =
  '﻿route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\r\n' +
  '330,0,"330","Zg.(Gl.k.)-V.G. brza",,3,,"ffffff","000000"\r\n' +
  '1,0,"1","Zap.kol. - Borongaj",,0,,"ffffff","000000"\r\n' +
  '17,0,"17","Prečko - Borongaj, ""Dubrava""",,0,,"ffffff","000000"\r\n';

const AGENCY_TXT = 'agency_id,agency_name,agency_url,agency_timezone\n0,ZET,https://www.zet.hr,Europe/Zagreb\n';

describe('readZipEntries', () => {
  it('lists entries from the central directory with method and sizes', () => {
    const zip = makeZip([
      { name: 'agency.txt', data: AGENCY_TXT, method: 0 },
      { name: 'routes.txt', data: ROUTES_TXT, method: 8 },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['agency.txt', 'routes.txt']);
    expect(entries[0].method).toBe(0);
    expect(entries[1].method).toBe(8);
    expect(entries[1].uncompressedSize).toBe(new TextEncoder().encode(ROUTES_TXT).length);
    expect(entries[1].compressedSize).toBeLessThan(entries[1].uncompressedSize);
  });

  it('rejects data that is not a zip archive', () => {
    expect(() => readZipEntries(new TextEncoder().encode('<html>not a zip</html>'))).toThrow(/end-of-central-directory/);
  });
});

describe('extractEntry', () => {
  it('returns stored bytes as-is and inflates deflated entries', () => {
    const zip = makeZip([
      { name: 'agency.txt', data: AGENCY_TXT, method: 0 },
      { name: 'routes.txt', data: ROUTES_TXT, method: 8 },
    ]);
    const [agency, routes] = readZipEntries(zip);
    // ignoreBOM: true because the plain TextDecoder() default silently strips a
    // leading BOM from its *output* string, which would make this "as-is" byte
    // check pass even if extractEntry corrupted or dropped the BOM bytes.
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(extractEntry(zip, agency))).toBe(AGENCY_TXT);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(extractEntry(zip, routes))).toBe(ROUTES_TXT);
  });
});

describe('parseCsv', () => {
  it('handles BOM, CRLF, quoted commas and doubled quotes', () => {
    const rows = parseCsv(ROUTES_TXT);
    expect(rows).toHaveLength(4);
    expect(rows[0][0]).toBe('route_id'); // BOM stripped
    expect(rows[3][3]).toBe('Prečko - Borongaj, "Dubrava"');
    expect(rows[1]).toHaveLength(9);
  });

  it('ignores a trailing empty line', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('buildRoutesIndex', () => {
  it('maps route_id to shortName, longName and integer type, sorted numerically', () => {
    const index = buildRoutesIndex(parseCsv(ROUTES_TXT));
    expect(Object.keys(index)).toEqual(['1', '17', '330']);
    expect(index['330']).toEqual({ shortName: '330', longName: 'Zg.(Gl.k.)-V.G. brza', type: 3 });
    expect(index['1']).toEqual({ shortName: '1', longName: 'Zap.kol. - Borongaj', type: 0 });
  });

  it('fails loudly when a required column is missing', () => {
    expect(() => buildRoutesIndex([['route_id', 'route_short_name'], ['1', '1']])).toThrow(/route_long_name/);
  });
});

describe('routesFromZip and main', () => {
  it('reads routes.txt out of a zip end to end', () => {
    const zip = makeZip([
      { name: 'agency.txt', data: AGENCY_TXT, method: 0 },
      { name: 'routes.txt', data: ROUTES_TXT, method: 8 },
    ]);
    expect(Object.keys(routesFromZip(zip))).toHaveLength(3);
  });

  it('throws when routes.txt is absent', () => {
    const zip = makeZip([{ name: 'agency.txt', data: AGENCY_TXT, method: 0 }]);
    expect(() => routesFromZip(zip)).toThrow(/routes\.txt not in archive/);
  });

  it('downloads with a fake fetch and writes the JSON file', async () => {
    const zip = makeZip([{ name: 'routes.txt', data: ROUTES_TXT, method: 8 }]);
    const dir = await mkdtemp(join(tmpdir(), 'zet-routes-'));
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(zip, { status: 200 });
    };
    const logs: string[] = [];
    const result = await main({ fetchImpl, cwd: dir, out: 'data/zet-routes.json', log: (s: string) => logs.push(s) });
    expect(calls).toEqual(['https://www.zet.hr/gtfs-scheduled/latest']);
    expect(result.count).toBe(3);
    const written = JSON.parse(await readFile(join(dir, 'data/zet-routes.json'), 'utf8'));
    expect(written['17'].longName).toBe('Prečko - Borongaj, "Dubrava"');
    expect(logs.join('\n')).toContain('Public dataset by ZET provided under Open license');
  });

  it('fails on a non-2xx download', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(main({ fetchImpl, log: () => {} })).rejects.toThrow(/HTTP 503/);
  });
});
