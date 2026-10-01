// Where the snimka pipeline reads and writes (lane S1). The recordings live in
// the owner's working folder `review.local/` of the MAIN checkout, never in a
// worktree and never in git, so both defaults resolve from the repository's
// common git directory: a worktree and MAIN itself find the same MAIN. Every
// stage reads only below `inputs` (and the repository's committed artefacts)
// and writes only below `out`.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { contentPath } from '../../shared/snimka-codec';
import type { HashedRef } from '../../shared/snimka';

export interface Paths {
  /** The checkout this build runs from (a worktree or MAIN): committed code and artefacts. */
  repo: string;
  /** The MAIN checkout whose `review.local/` holds the recordings. */
  main: string;
  /** The recordings root (`<main>/review.local` by default). */
  inputs: string;
  /** The build root (`<inputs>/snimka/build/v1` by default). */
  out: string;
  objects: string;
  work: string;
  state: string;
}

/** MAIN: the parent of the repository's common git directory (a worktree's `.git` file points there). */
export function mainCheckout(repo: string): string {
  try {
    const common = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return repo;
  }
}

export function resolvePaths(repo: string, o: { inputs?: string; out?: string } = {}): Paths {
  const main = mainCheckout(repo);
  const inputs = resolve(o.inputs ?? join(main, 'review.local'));
  const out = resolve(o.out ?? join(inputs, 'snimka', 'build', 'v1'));
  const paths = { repo, main, inputs, out, objects: join(out, 'objects'), work: join(out, 'work'), state: join(out, 'state') };
  for (const dir of [paths.objects, paths.work, paths.state]) mkdirSync(dir, { recursive: true });
  // Read-only inputs: the build root may sit inside them, but never in the recorders' own folders.
  for (const forbidden of ['companion/recordings', 'strike']) {
    const rel = relative(join(inputs, forbidden), out);
    if (!rel.startsWith('..') && !rel.startsWith('/')) throw new Error(`snimka: refusing to write below ${join(inputs, forbidden)}`);
  }
  return paths;
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Writes one immutable object under `objects/` by its content name and returns its ref. */
export function writeObject(paths: Paths, name: string, ext: 'json' | 'webp', bytes: Uint8Array | string): HashedRef {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  const hash = sha256(buf);
  const path = contentPath(name, hash, ext);
  const file = join(paths.objects, path);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file) || statSync(file).size !== buf.length) writeFileSync(file, buf);
  return { path, bytes: buf.length, sha256: hash };
}

export const writeJsonObject = (paths: Paths, name: string, value: unknown): HashedRef => writeObject(paths, name, 'json', JSON.stringify(value));

export function writeWork(paths: Paths, name: string, value: unknown): string {
  const file = join(paths.work, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  return file;
}

export function readWork<T>(paths: Paths, name: string): T {
  const file = join(paths.work, name);
  if (!existsSync(file)) throw new Error(`snimka: ${relative(paths.out, file)} is missing: run its stage first`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** A directory's listing as a fingerprint: names, sizes and modification times (sorted). */
export function listingPrint(dir: string, keep: (name: string) => boolean = () => true): string {
  if (!existsSync(dir)) return `${dir}:absent`;
  const h = createHash('sha256');
  for (const name of readdirSync(dir).filter(keep).sort()) {
    const st = statSync(join(dir, name));
    h.update(`${name}\t${st.size}\t${Math.floor(st.mtimeMs)}\n`);
  }
  return h.digest('hex');
}

/** One file as a fingerprint: its content hash. */
export function filePrint(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : `${file}:absent`;
}
