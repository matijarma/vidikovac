// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScanOk } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { codeFromHash, confirmLabel, dashboardUrl } from '../../app/src/scan';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const KIOSK: ScanOk = {
  roomId: 'r1',
  ticket: 't1',
  beaconType: 'kiosk',
  venueType: 'kafic',
  area: 'Donji grad',
  expiresAt: NOW + 10 * 60_000,
  participants: 1,
  screenLabel: 'Kavana Velebit',
};
const PHONE: ScanOk = {
  roomId: 'r2',
  ticket: 't2',
  beaconType: 'phone',
  venueType: null,
  area: null,
  expiresAt: NOW + 5 * 60_000 - 400,
  participants: 1,
  screenLabel: null,
};

describe('codeFromHash', () => {
  it('reads our own QR fragment in both forms and refuses anything else', () => {
    expect(codeFromHash('#ABCD-EFGH')).toBe('ABCDEFGH');
    expect(codeFromHash('#abcdefgh')).toBe('ABCDEFGH');
    expect(codeFromHash('#code=abcd-efgh')).toBe('ABCDEFGH');
    expect(codeFromHash('#ilo1-abcd')).toBe('1101ABCD');
    expect(codeFromHash('#ABCU-EFGH')).toBeNull(); // U is not in the alphabet
    expect(codeFromHash('#room=r1&ticket=t1')).toBeNull();
    expect(codeFromHash('#ABCD')).toBeNull();
    expect(codeFromHash('#%E0%A4%A')).toBeNull();
    expect(codeFromHash('')).toBeNull();
  });
});

describe('confirmLabel', () => {
  it('names the kind of screen, the district and the minutes', () => {
    const i18n = createDefaultI18n('hr');
    expect(confirmLabel(KIOSK, i18n, NOW)).toBe('Zaslon: kafić, Donji grad, 10 minuta');
  });
  it('names the other person’s phone and its five minutes', () => {
    expect(confirmLabel(PHONE, createDefaultI18n('hr'), NOW)).toBe('Telefon druge osobe, 5 minuta');
  });
  it('drops the empty district instead of printing a dangling comma', () => {
    const i18n = createDefaultI18n('hr');
    expect(confirmLabel({ ...KIOSK, area: null }, i18n, NOW)).toBe('Zaslon: kafić, 10 minuta');
  });
  it('falls back to the neutral venue word for an unknown screen', () => {
    const i18n = createDefaultI18n('hr');
    expect(confirmLabel({ ...KIOSK, venueType: null }, i18n, NOW)).toBe('Zaslon: javni zaslon, Donji grad, 10 minuta');
  });
});

describe('dashboardUrl', () => {
  it('puts room, ticket and a label in the fragment, never in the query', () => {
    expect(dashboardUrl(KIOSK)).toBe('/d/#room=r1&ticket=t1&label=Kavana%20Velebit');
    expect(dashboardUrl(PHONE)).toBe('/d/#room=r2&ticket=t2&label=phone');
  });
});

import { beforeEach, vi } from 'vitest';
import type { ScanFail } from '../../worker/protocol';
import { createScanPage } from '../../app/src/scan';
import { flush, text } from './helpers';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mount(options: {
  hash?: string;
  result?: ScanOk | ScanFail;
  scan?: (code: string) => Promise<ScanOk | ScanFail>;
} = {}) {
  const root = document.createElement('main');
  document.body.appendChild(root);
  const navigate = vi.fn();
  const replaceUrl = vi.fn();
  const scan = vi.fn(options.scan ?? (async () => options.result ?? KIOSK));
  const handle = createScanPage(root, {
    i18n: createDefaultI18n('hr'),
    hash: options.hash ?? '',
    navigate,
    replaceUrl,
    now: () => NOW,
    scan,
  });
  const input = root.querySelector<HTMLInputElement>('[data-testid=code-input]')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const submitButton = root.querySelector<HTMLButtonElement>('[data-testid=code-submit]')!;
  const type = (value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const send = (): void => {
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  return { root, handle, navigate, replaceUrl, scan, input, form, submitButton, type, send };
}

const ERRORS: [ScanFail['error'], string][] = [
  ['bad-request', 'Kod nije u ispravnom obliku.'],
  ['code-unknown', 'Taj kod ne postoji ili je prošao. Pogledaj zaslon i skeniraj ponovno.'],
  ['code-expired', 'Kod je istekao. Zaslon već pokazuje novi.'],
  ['code-used', 'Taj je kod već iskorišten. Pričekaj novi na zaslonu.'],
  ['screen-offline', 'Zaslon je trenutačno bez veze. Pokušaj za minutu.'],
  ['same-network', 'Ovaj zaslon i tvoj telefon dijele istu mrežu. Isključi Wi-Fi i skeniraj mobilnim podacima.'],
  ['slow-down', 'Previše pokušaja. Pričekaj minutu.'],
  ['rate-limited', 'Previše pokušaja s ove mreže. Pričekaj minutu.'],
  ['revoked', 'Ovaj je zaslon isključen.'],
];

describe('createScanPage', () => {
  it('always offers the typed code, with the alphabet warning and no camera by default', () => {
    const { root } = mount();
    expect(root.querySelector('h1')?.textContent).toBe('Otključaj pogled na Zagreb');
    expect(root.querySelector('[data-testid=code-input]')).not.toBeNull();
    expect(text(root.querySelector('#scan-hint'))).toBe('Osam znakova, npr. ABCD-EFGH. Slova I, L i O ne postoje: upiši 1 ili 0.');
    expect(root.querySelector('[data-testid=scan-camera]')).toBeNull();
    expect(root.querySelector('[data-testid=scan-error]')?.getAttribute('role')).toBe('alert');
    expect(root.querySelector('[data-testid=scan-status]')?.getAttribute('role')).toBe('status');
  });

  it('formats typing as ABCD-EFGH, maps I, L and O, and enables submit only when complete', () => {
    const { input, submitButton, type } = mount();
    type('ilo1abc');
    expect(input.value).toBe('1101-ABC');
    expect(submitButton.disabled).toBe(true);
    type('1101-ABCD');
    expect(input.value).toBe('1101-ABCD');
    expect(submitButton.disabled).toBe(false);
  });

  it('scans the code from the fragment, shows the approved confirm card and takes the code out of the address bar', async () => {
    const { root, scan, replaceUrl } = mount({ hash: '#ABCD-EFGH' });
    await flush();
    expect(scan).toHaveBeenCalledWith('ABCDEFGH');
    const card = root.querySelector<HTMLElement>('[data-testid=confirm-card]')!;
    expect(card.hidden).toBe(false);
    expect(text(card.querySelector('.scan-confirm-title'))).toBe('Isti kod je na zaslonu?');
    expect(text(card.querySelector('[data-testid=confirm-code]'))).toBe('ABCD-EFGH');
    expect(card.querySelector('[data-testid=confirm-code]')?.getAttribute('aria-label')).toBe('A B C D, E F G H');
    expect(text(card.querySelector('[data-testid=confirm-label]'))).toBe('Zaslon: kafić, Donji grad, 10 minuta');
    expect(card.querySelector('[data-testid=unlock]')?.textContent).toBe('Otključaj');
    expect(document.activeElement).toBe(card);
    expect(replaceUrl).toHaveBeenCalledWith('/s/');
  });

  it('Otključaj navigates to the dashboard once, however often it is pressed', async () => {
    const { root, navigate } = mount({ hash: '#ABCD-EFGH' });
    await flush();
    const unlock = root.querySelector<HTMLButtonElement>('[data-testid=unlock]')!;
    unlock.click();
    unlock.click();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/d/#room=r1&ticket=t1&label=Kavana%20Velebit');
  });

  it('Odustani puts the person back in the field with the card gone', async () => {
    const { root, input } = mount({ hash: '#ABCD-EFGH' });
    await flush();
    root.querySelector<HTMLButtonElement>('[data-testid=confirm-cancel]')!.click();
    expect(root.querySelector<HTMLElement>('[data-testid=confirm-card]')!.hidden).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it.each(ERRORS)('shows the Croatian sentence for %s and keeps the field usable', async (error, message) => {
    const { root, input } = mount({ hash: '#ABCD-EFGH', result: { error, message: 'server text' } });
    await flush();
    expect(text(root.querySelector('[role=alert]'))).toBe(message);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('scan-hint scan-error');
    expect(document.activeElement).toBe(input);
    expect(root.querySelector<HTMLElement>('[data-testid=confirm-card]')!.hidden).toBe(true);
  });

  it('maps the client-side network failure to the network sentence', async () => {
    const { root } = mount({ hash: '#ABCD-EFGH', result: { error: 'bad-request', message: 'network' } });
    await flush();
    expect(text(root.querySelector('[role=alert]'))).toBe('Nema veze s poslužiteljem. Provjeri mrežu i pokušaj ponovno.');
  });

  it('falls back to the server sentence for an error the catalog does not know', async () => {
    const unknown = { error: 'teapot', message: 'Nešto posve novo.' } as unknown as ScanFail;
    const { root } = mount({ hash: '#ABCD-EFGH', result: unknown });
    await flush();
    expect(text(root.querySelector('[role=alert]'))).toBe('Nešto posve novo.');
  });

  it('refuses an incomplete typed code without touching the network', async () => {
    const { root, scan, input, type, send } = mount();
    type('ABC');
    send();
    await flush();
    expect(scan).not.toHaveBeenCalled();
    expect(text(root.querySelector('[role=alert]'))).toBe('Kod nije potpun. Upiši svih osam znakova.');
    expect(document.activeElement).toBe(input);
  });

  it('sends one request per submit and announces the wait while it is in flight', async () => {
    let release!: (value: ScanOk) => void;
    const pending = new Promise<ScanOk>((resolve) => {
      release = resolve;
    });
    const { root, scan, input, type, send } = mount({ scan: () => pending });
    type('ABCD-EFGH');
    send();
    send();
    await flush();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(text(root.querySelector('[data-testid=scan-status]'))).toBe('Provjera koda…');
    expect(input.disabled).toBe(true);
    release(KIOSK);
    await flush();
    expect(text(root.querySelector('[data-testid=scan-status]'))).toBe('');
    expect(input.disabled).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-testid=confirm-card]')!.hidden).toBe(false);
  });

  it('destroy() takes the section off the page', () => {
    const { root, handle } = mount();
    handle.destroy();
    expect(root.querySelector('.scan')).toBeNull();
  });
});

import type { QrScannerDeps, QrScannerHandle } from '../../app/src/ui/qrScanner';

interface FakeScanner extends QrScannerHandle {
  deps: QrScannerDeps;
  started: number;
  destroyed: number;
}

function mountWithCamera(options: { result?: ScanOk | ScanFail } = {}) {
  const root = document.createElement('main');
  document.body.appendChild(root);
  const navigate = vi.fn();
  const scan = vi.fn(async () => options.result ?? KIOSK);
  let scanner: FakeScanner | null = null;
  createScanPage(root, {
    i18n: createDefaultI18n('hr'),
    hash: '',
    navigate,
    replaceUrl: vi.fn(),
    now: () => NOW,
    scan,
    scannerSupported: true,
    createScanner: (deps) => {
      const element = document.createElement('div');
      element.className = 'qr-scanner';
      const fake: FakeScanner = {
        deps,
        started: 0,
        destroyed: 0,
        element,
        start: async () => {
          fake.started += 1;
        },
        stop: () => {},
        destroy: () => {
          fake.destroyed += 1;
          element.remove();
        },
      };
      scanner = fake;
      return fake;
    },
  });
  const button = root.querySelector<HTMLButtonElement>('[data-testid=scan-camera]')!;
  const region = root.querySelector<HTMLElement>('[data-testid=scan-camera-region]')!;
  const input = root.querySelector<HTMLInputElement>('[data-testid=code-input]')!;
  return { root, button, region, input, scan, scanner: () => scanner!, navigate };
}

describe('camera region', () => {
  it('offers the camera only when the platform can decode, and starts it inside the region', () => {
    const { button, region, scanner } = mountWithCamera();
    expect(button.textContent).toContain('Skeniraj kamerom');
    expect(button.getAttribute('aria-controls')).toBe('scan-camera-region');
    expect(region.hidden).toBe(true);
    button.click();
    expect(region.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(scanner().started).toBe(1);
    expect(region.querySelector('.qr-scanner')).not.toBeNull();
    expect(scanner().deps.strings.hint).toBe('Usmjeri kameru prema QR kodu na zaslonu.');
  });

  it('a decoded Vidikovac payload fills the field, closes the camera and submits', async () => {
    const { button, region, input, scan, scanner } = mountWithCamera();
    button.click();
    scanner().deps.onResult('https://zagreb.aningfilm.hr/s#ABCD-EFGH');
    await flush();
    expect(input.value).toBe('ABCD-EFGH');
    expect(scan).toHaveBeenCalledWith('ABCDEFGH');
    expect(scanner().destroyed).toBe(1);
    expect(region.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a foreign QR code is named as such instead of being posted', async () => {
    const { root, button, scan, scanner } = mountWithCamera();
    button.click();
    scanner().deps.onResult('WIFI:S:kafic;T:WPA;P:tajna;;');
    await flush();
    expect(scan).not.toHaveBeenCalled();
    expect(text(root.querySelector('[role=alert]'))).toBe('To nije kod s našeg zaslona. Skeniraj QR kod sa zaslona ili upiši osam slova.');
  });

  it('a refused or missing camera closes the region and sends the person to the field', () => {
    const denied = mountWithCamera();
    denied.button.click();
    denied.scanner().deps.onError?.('denied');
    expect(text(denied.root.querySelector('[role=alert]'))).toBe('Pristup kameri je odbijen. Upiši kod ručno.');
    expect(denied.region.hidden).toBe(true);
    expect(document.activeElement).toBe(denied.input);

    const busy = mountWithCamera();
    busy.button.click();
    busy.scanner().deps.onError?.('unavailable');
    expect(text(busy.root.querySelector('[role=alert]'))).toBe('Kamera nije dostupna. Upiši kod ručno.');
  });

  it('Odustani in the camera returns focus to the button', () => {
    const { button, region, scanner } = mountWithCamera();
    button.click();
    scanner().deps.onCancel?.();
    expect(region.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });
});

// Reproduces the review finding on scan.css:39-47 vs base.css:43-47: a bare
// `.scan-input` (specificity 0,1,0) loses every contested longhand to the
// generic `input[type='text'], select` reset in base.css (0,1,1) — border,
// min-height, font-family and font-size all silently fall back to the base
// rule's values regardless of file/import order, since there is no @layer,
// !important or :where() anywhere in the codebase. This computes real CSS
// specificity (a, b, c) from the selector text so the check keeps holding
// for whatever selector shape the fix takes, not just today's exact string.
//
// Fix round 2 reproduces a second-order finding on the round-1 fix itself:
// raising `.scan-input` to `input[type='text'].scan-input` (0,2,1) made it
// EXACTLY TIE base.css's `input[type='text']:focus-visible` rule, also
// (0,2,1) — and because scan.css loads after base.css on every built page,
// the tie resolves in scan.css's favour. `.scan-input`'s old `border: 2px
// solid var(--tone-stroke-strong)` shorthand set border-color, which then
// silently beat the focus-visible rule's `border-color: var(--tone-focus-ring)`
// on every keyboard focus. The fix drops border-color from `.scan-input`
// entirely (border-width/border-style only) so the two rules never contest
// the same property; the tests below assert that directly and, more
// generally, that no property `.scan-input` declares overlaps any property
// base.css's `:focus-visible` rule declares — robust to whatever `.scan-input`
// or the focus-visible rule declare next, not just today's property list.
describe('scan-input CSS specificity (regression: base.css must not win)', () => {
  const RAW_BASE_CSS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'base.css'), 'utf8');
  const RAW_SCAN_CSS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'scan.css'), 'utf8');
  // Comment-stripped so a code comment's prose (this test's own included —
  // it names the selectors it's checking for readability) can never be
  // mistaken for the CSS it describes.
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const BASE_CSS = stripComments(RAW_BASE_CSS);
  const SCAN_CSS = stripComments(RAW_SCAN_CSS);

  /** CSS specificity of one simple (combinator-free) selector, as (id, class-like, type-like). */
  function specificity(selector: string): [number, number, number] {
    let working = selector.trim();
    let a = 0;
    let b = 0;
    let c = 0;
    working = working.replace(/::?(before|after|first-line|first-letter)\b/g, () => {
      c += 1;
      return ' ';
    });
    working = working.replace(/::[\w-]+/g, () => {
      c += 1;
      return ' ';
    });
    working = working.replace(/\[[^\]]*\]/g, () => {
      b += 1;
      return ' ';
    });
    working = working.replace(/#[\w-]+/g, () => {
      a += 1;
      return ' ';
    });
    working = working.replace(/\.[\w-]+/g, () => {
      b += 1;
      return ' ';
    });
    working = working.replace(/:[\w-]+(\([^)]*\))?/g, () => {
      b += 1;
      return ' ';
    });
    c += (working.match(/[a-zA-Z][\w-]*/g) ?? []).length;
    return [a, b, c];
  }

  function cmp(x: [number, number, number], y: [number, number, number]): number {
    for (let i = 0; i < 3; i += 1) {
      if (x[i] !== y[i]) return x[i]! - y[i]!;
    }
    return 0;
  }

  /** The exact selector line that opens the `.scan-input` rule in scan.css. */
  function scanInputSelector(): string {
    const m = /^([^{}]*\.scan-input[^{}]*)\{/m.exec(SCAN_CSS);
    if (!m) throw new Error('scan.css has no rule targeting .scan-input');
    return m[1]!.trim();
  }

  /** The comma-branch of base.css's generic reset that itself matches `input`. */
  function baseInputSelector(): string {
    const m = /^input\[type='text'\][^{]*,\s*select\s*\{/m.exec(BASE_CSS);
    if (!m) throw new Error("base.css has no `input[type='text'], select` reset — has the generic rule moved?");
    return "input[type='text']";
  }

  /** The `{ ... }` body immediately following the given rule's selector line. */
  function ruleBody(css: string, selectorLine: RegExp): string {
    const m = selectorLine.exec(css);
    if (!m) throw new Error(`no rule found for ${selectorLine}`);
    const start = m.index;
    return css.slice(start, css.indexOf('}', start) + 1);
  }

  it('neither the .scan-input rule nor the base input reset is wrapped in @layer, !important or :where() — specificity math alone decides the winner', () => {
    // Scoped to the two contending rules, not the whole file: base.css does
    // use !important elsewhere (e.g. .visually-hidden), which is unrelated
    // to this cascade fight. If this ever fires on either rule, cascade
    // layers/!important/:where() have entered and the plain specificity
    // comparison below is no longer the whole story.
    const scanRule = ruleBody(SCAN_CSS, /^([^{}]*\.scan-input[^{}]*)\{/m);
    const baseRule = ruleBody(BASE_CSS, /^input\[type='text'\][^{]*,\s*select\s*\{/m);
    for (const body of [scanRule, baseRule]) {
      expect(body).not.toMatch(/!important/);
    }
    expect(BASE_CSS).not.toMatch(/@layer/);
    expect(SCAN_CSS).not.toMatch(/@layer/);
    expect(BASE_CSS).not.toMatch(/:where\(/);
    expect(SCAN_CSS).not.toMatch(/:where\(/);
  });

  it("base.css's generic input reset really does carry (0,1,1)", () => {
    expect(specificity(baseInputSelector())).toEqual([0, 1, 1]);
  });

  it('.scan-input rule out-specifies (or ties and follows) the base reset, so its declarations actually win', () => {
    const scanSel = scanInputSelector();
    const scanSpec = specificity(scanSel);
    const baseSpec = specificity(baseInputSelector());
    // scan.css is imported after base.css (app/src/entries/scan.ts), so an
    // exact tie would still win on source order — but only a strictly higher
    // specificity is robust to that import order ever changing.
    expect(cmp(scanSpec, baseSpec), `.scan-input selector "${scanSel}" must out-specify "input[type='text']"`).toBeGreaterThan(0);
  });

  it('the contested longhands are set directly on the .scan-input rule, not left to the generic reset', () => {
    const start = SCAN_CSS.indexOf(scanInputSelector());
    const body = SCAN_CSS.slice(start, SCAN_CSS.indexOf('}', start) + 1);
    expect(body).toMatch(/border-width:\s*2px/);
    expect(body).toMatch(/border-style:\s*solid/);
    expect(body).toMatch(/min-height:\s*3\.25rem/);
    expect(body).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(body).toMatch(/font-size:\s*1\.75rem/);
  });

  /** The exact selector line that opens base.css's `input[type='text']:focus-visible` rule. */
  function baseFocusVisibleSelector(): string {
    const m = /^input\[type='text'\]:focus-visible\s*\{/m.exec(BASE_CSS);
    if (!m) throw new Error("base.css has no `input[type='text']:focus-visible` rule — has it moved or been renamed?");
    return "input[type='text']:focus-visible";
  }

  /** Property names (before the `:`) declared directly in a `{ ... }` rule body, longhand or shorthand. */
  function declaredProperties(body: string): string[] {
    const inner = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'));
    return inner
      .split(';')
      .map((decl) => decl.split(':')[0]?.trim())
      .filter((prop): prop is string => !!prop);
  }

  // A shorthand and a longhand it covers are the same contested property for
  // cascade purposes — `border: ...` sets border-color exactly as much as
  // `border-color: ...` does. Expanding to the sub-properties each shorthand
  // used in this codebase's input styling actually sets is what makes the
  // overlap check below catch the shorthand-vs-longhand shape of this bug,
  // not just an exact string match on the property name.
  const SHORTHAND_EXPANSIONS: Record<string, string[]> = {
    border: ['border-width', 'border-style', 'border-color'],
    font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  };

  /** Declared properties, with any shorthand expanded to the longhands it sets. */
  function effectiveProperties(body: string): Set<string> {
    const out = new Set<string>();
    for (const prop of declaredProperties(body)) {
      for (const expanded of SHORTHAND_EXPANSIONS[prop] ?? [prop]) out.add(expanded);
    }
    return out;
  }

  it("base.css's :focus-visible rule really does carry (0,2,1), tying .scan-input's (0,2,1)", () => {
    const focusSpec = specificity(baseFocusVisibleSelector());
    expect(focusSpec).toEqual([0, 2, 1]);
    expect(cmp(focusSpec, specificity(scanInputSelector()))).toBe(0);
  });

  it('.scan-input does not declare border-color (longhand or the `border` shorthand) — it must never contest the tied :focus-visible rule for that property', () => {
    const start = SCAN_CSS.indexOf(scanInputSelector());
    const body = SCAN_CSS.slice(start, SCAN_CSS.indexOf('}', start) + 1);
    const props = declaredProperties(body);
    expect(props).not.toContain('border-color');
    expect(props).not.toContain('border'); // the shorthand implies a border-color sub-value too
  });

  it('no property .scan-input declares (shorthand expanded) overlaps a property the tied :focus-visible rule declares (the general form of the regression)', () => {
    const scanBody = ruleBody(SCAN_CSS, /^([^{}]*\.scan-input[^{}]*)\{/m);
    const focusBody = ruleBody(BASE_CSS, /^input\[type='text'\]:focus-visible\s*\{/m);
    const scanProps = effectiveProperties(scanBody);
    const focusProps = [...effectiveProperties(focusBody)];
    expect(focusProps.length).toBeGreaterThan(0); // sanity: the extraction actually found the rule's declarations
    const overlap = focusProps.filter((p) => scanProps.has(p));
    expect(overlap, `.scan-input and the tied (0,2,1) :focus-visible rule both declare: ${overlap.join(', ')}`).toEqual([]);
  });
});
