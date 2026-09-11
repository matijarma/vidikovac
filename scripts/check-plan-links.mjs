#!/usr/bin/env node
// Pre-filing check for the source register and the application text.
//   node scripts/check-plan-links.mjs            # every URL in docs/izvori.md answers; every ModuleId has a row
//   node scripts/check-plan-links.mjs --filing   # additionally: no [[POPUNITI ...]] field left in docs/prijava
// Prints a table and exits 1 on any failure. HEAD first, then GET with the body
// cancelled (the ZET static GTFS is 15 MB; we want its status, not its bytes).
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USER_AGENT = 'vidikovac-link-check/0.1 (+https://zagreb.aningfilm.hr)';
const URL_RE = /https?:\/\/[^\s<>()\[\]"'`|]+/g;

/** Unique http(s) URLs in document order; trailing punctuation dropped; template URLs ({...}) skipped. */
export function extractUrls(markdown) {
  const out = [];
  const seen = new Set();
  for (const m of markdown.matchAll(URL_RE)) {
    let url = m[0].replace(/[.,;:!?]+$/, '');
    if (url.includes('{') || url.includes('}')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function moduleIdsFromSchema(src) {
  const m = src.match(/export type ModuleId =([\s\S]*?);/);
  if (!m) throw new Error('ModuleId union not found');
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
}

/** Ids without a table row starting `| \`id\` |`. */
export function missingModuleIds(ids, markdown) {
  return ids.filter((id) => !new RegExp(`^\\| \`${id}\` \\|`, 'm').test(markdown));
}

export async function checkUrl(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const started = Date.now();
  const attempt = async (method) => {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.body) await res.body.cancel();
    return res;
  };
  try {
    let method = 'HEAD';
    let res = await attempt(method);
    if (res.status === 405 || res.status === 403 || res.status === 501 || res.status >= 500) {
      method = 'GET';
      res = await attempt(method);
    }
    return { url, method, status: res.status, ok: res.status >= 200 && res.status < 400, ms: Date.now() - started };
  } catch (err) {
    return { url, method: '-', status: 0, ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

export function findFillFields(text) {
  return [...text.matchAll(/\[\[POPUNITI[^\]]*\]\]/g)].map((m) => m[0]);
}

export function renderTable(rows) {
  const urlWidth = Math.max('URL'.length, ...rows.map((r) => r.url.length));
  const line = (ok, status, method, ms, url, error) =>
    `${ok.padEnd(4)}  ${String(status).padStart(6)}  ${method.padEnd(6)}  ${String(ms).padStart(5)}  ${url.padEnd(urlWidth)}${error ? `  ${error}` : ''}`.trimEnd();
  return [
    line('OK', 'STATUS', 'METHOD', 'MS', 'URL'),
    ...rows.map((r) => line(r.ok ? 'ok' : 'FAIL', r.status, r.method, r.ms, r.url, r.error)),
  ].join('\n');
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log, fetchImpl = fetch } = {}) {
  const filing = argv.includes('--filing');
  const izvoriPath = argv.find((a) => a.endsWith('.md')) ?? 'docs/izvori.md';
  const izvori = await readFile(resolve(cwd, izvoriPath), 'utf8');
  const schema = await readFile(resolve(cwd, 'worker/feed/schema.ts'), 'utf8');
  let failures = 0;

  const missing = missingModuleIds(moduleIdsFromSchema(schema), izvori);
  if (missing.length > 0) {
    log(`Modules without a row in ${izvoriPath}: ${missing.join(', ')}`);
    failures += missing.length;
  }

  const urls = extractUrls(izvori);
  const rows = await mapLimit(urls, 4, (u) => checkUrl(u, { fetchImpl }));
  log(renderTable(rows));
  failures += rows.filter((r) => !r.ok).length;

  if (filing) {
    const dir = resolve(cwd, 'docs/prijava');
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()) {
      const fields = findFillFields(await readFile(resolve(dir, name), 'utf8'));
      for (const f of fields) log(`POPUNITI  docs/prijava/${name}  ${f}`);
      failures += fields.length;
    }
  }

  log(failures === 0 ? `\nAll ${urls.length} URLs answer; every module documented${filing ? '; no fill-in fields left' : ''}.` : `\n${failures} problem(s).`);
  return failures === 0 ? 0 : 1;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  }, (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
