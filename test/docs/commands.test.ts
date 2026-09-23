import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// WP6 step 11: every command the verification documents tell a reader to run
// exists. An `npm run <name>` is a script in package.json, a `node scripts/<file>`
// is a file in scripts/, so a renamed or retired script turns this red instead of
// leaving a dead line in README.md, docs/kiosk.md or docs/kaj-verification.md.
// The acceptance section of docs/kaj-verification.md is held to its own floor
// (WP6 acceptance A12: at least twelve table rows) and to the house style of
// every new Croatian document: no em dash, no ellipsis, no "zid".
const url = (path: string) => new URL(`../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(url(path), 'utf8');
const DOCS = ['README.md', 'docs/kiosk.md', 'docs/kaj-verification.md'];
const SCRIPTS = new Set(Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts));

/** The text from a `## ` heading up to the next `## ` heading (or the end). */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  expect(start, `no section "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

/** Table rows (lines starting "| ") between a `### ` heading and the next heading. */
function tableRows(markdown: string, heading: string): string[] {
  const start = markdown.indexOf(`\n### ${heading}\n`);
  expect(start, `no subsection "### ${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + heading.length + 6);
  const end = rest.search(/\n#{2,3} /);
  return (end === -1 ? rest : rest.slice(0, end)).split('\n').filter((line) => line.startsWith('| ') && !/^\|\s*-/.test(line));
}

describe('commands cited in the verification documents', () => {
  it.each([['accept:e2e', ['accept']], ['e2e', ['chromium', 'mobile']]] as const)('%s keeps an appended filename out of the variadic project option', (name, projects) => {
    // Only the bundled argument parser, never the Playwright runner, browser
    // or web server. This is the same variadic option declared by its CLI.
    const { program } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
    const parser = program.createCommand().argument('[files...]').option('--project <project-name...>').exitOverride();
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const file = 'e2e/accept/wall.spec.ts';
    parser.parse([...scripts[name]!.split(/\s+/).slice(2), file], { from: 'user' });
    expect(parser.opts().project).toEqual(projects);
    expect(parser.args).toEqual([file]);
  });
  it.each(DOCS)('%s names only npm scripts that package.json defines', (doc) => {
    const cited = [...read(doc).matchAll(/\bnpm run ([a-z][\w:-]*)/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    expect([...new Set(cited)].filter((name) => !SCRIPTS.has(name))).toEqual([]);
  });

  it.each(DOCS)('%s runs only node scripts that exist under scripts/', (doc) => {
    const cited = [...read(doc).matchAll(/\bnode (scripts\/[\w./-]+\.(?:mjs|js|ts))\b/g)].map((m) => m[1]);
    expect([...new Set(cited)].filter((file) => !existsSync(url(file)))).toEqual([]);
  });

  it('README.md lists the test, acceptance, grader, sampler and observer commands', () => {
    const readme = read('README.md');
    for (const command of ['npm run typecheck', 'npm run typecheck:tests', 'npm test', 'npm run e2e', 'npm run review:visual', 'npm run accept', 'npm run accept:e2e', 'npm run replay:grade', 'npm run frames:sample', 'npm run observe:production']) {
      expect(readme, command).toContain(command);
    }
  });
});

describe('docs/kaj-verification.md, "Prihvaćanje, companion 2026-09"', () => {
  const doc = read('docs/kaj-verification.md');
  const acceptance = section(doc, 'Prihvaćanje, companion 2026-09');

  it('holds the acceptance table, the 3-metre rule, the device checklist and what never enters git', () => {
    expect(acceptance.split('\n').filter((line) => line.startsWith('| ')).length).toBeGreaterThanOrEqual(12);
    for (const heading of ['Tri metra', 'Ručne provjere na uređaju', 'Što nikad ne ulazi u git']) expect(acceptance).toContain(`\n### ${heading}\n`);
    expect(tableRows(acceptance, 'Ručne provjere na uređaju').length - 1).toBeGreaterThanOrEqual(11);
    for (const command of ['npm run accept', 'npm run accept:e2e', 'npm run replay:grade', 'npm run observe:production', 'npm run frames:sample']) {
      expect(acceptance, command).toContain(command);
    }
    expect(acceptance).toContain('e2e/legibility.ts');
    expect(acceptance).toContain('test/fixtures/frames/2026-09-21-1715-1744/README.md');
  });

  it('keeps the house style: no em dash, no ellipsis, no "zid"', () => {
    expect(acceptance).not.toMatch(/—|…/);
    expect(acceptance).not.toMatch(/\bzid/i);
  });

  it('names the grader in scripts/, not the review tree', () => {
    expect(doc).not.toMatch(/node review\.local\//);
    expect(doc).toContain('npm run replay:grade');
  });
});
