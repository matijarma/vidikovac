// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanFail, ScanOk, ScreenStop } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { codeFromHash, confirmLabel, createScanPage, dashboardUrl } from '../../app/src/scan';
import type { QrScannerDeps, QrScannerHandle } from '../../app/src/ui/qrScanner';
import { flush, text } from './helpers';

const REPO = join(import.meta.dirname, '..', '..');
const read = (...parts: string[]): string => readFileSync(join(REPO, ...parts), 'utf8');

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
const STOP: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9769, lat: 45.813, routes: ['6', '11', '12', '13'] };
const AT_STOP: ScanOk = { ...KIOSK, screen: { kind: 'venue', expiresAt: null, stop: STOP } };

/** Comment-stripped CSS, so a comment's prose can never be mistaken for the rules it describes. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The `{ ... }` body immediately following the given rule's selector line. */
function ruleBody(css: string, selectorLine: RegExp): string {
  const m = selectorLine.exec(css);
  if (!m) throw new Error(`no rule found for ${selectorLine}`);
  const start = m.index;
  return css.slice(start, css.indexOf('}', start) + 1);
}

/** True when `first` precedes `second` in document order. */
const before = (first: Element, second: Element): boolean =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

// The page is styled from the first paint: the five sheets are <link>s in
// <head>, ahead of the entry module, in cascade order (signage.css directly
// after base.css, scan.css after both, the viewfinder last). The entry imports
// base.css and signage.css a second time: test/app/signage-css.test.ts (area
// A's contract) pins that the entry of every page showing a badge imports the
// signage sheet directly after base.css. Rollup keeps one copy of each module,
// so the built page links every sheet once, in the head's order. The entry
// imports none of tokens, scan or qrScanner, and the font sheet stays a
// dynamic import so Manrope arrives after the first paint, never in front of it.
describe('/s/ is styled from the first paint', () => {
  const HTML = read('app', 's', 'index.html');
  const ENTRY = read('app', 'src', 'entries', 'scan.ts');

  it('links tokens, base, signage, scan and the viewfinder sheet in <head>, in that order, before any script', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'));
    const links = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    expect(links).toEqual(['/src/ui/tokens.css', '/src/ui/base.css', '/src/ui/signage.css', '/src/ui/scan.css', '/src/ui/qrScanner.css']);
    expect(head.indexOf('<link rel="stylesheet"')).toBeLessThan(head.indexOf('<script'));
    expect(HTML).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    expect(HTML).not.toContain('<style>');
  });

  it('the entry imports base.css then signage.css for the signage contract, none of the other linked sheets, and loads the font sheet dynamically', () => {
    expect(ENTRY).toContain("import '../ui/base.css';\nimport '../ui/signage.css';");
    for (const sheet of ['tokens', 'scan', 'qrScanner']) {
      expect(ENTRY, sheet).not.toContain(`import '../ui/${sheet}.css'`);
    }
    expect(ENTRY).toContain("import('../ui/fonts.css')");
    expect(ENTRY).not.toContain("import '../ui/fonts.css'");
    expect(ENTRY).toContain("import '../ui/toast.css'");
  });
});

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

// The session label the status line says while the page hands over to /d/ is
// assembled from parts joined by a middle dot, never by interpolating a
// sentence and then scrubbing the holes with regexes: an absent part leaves
// nothing behind.
describe('confirmLabel', () => {
  const i18n = createDefaultI18n('hr');
  it('joins the screen label, the district and the minutes', () => {
    expect(confirmLabel(KIOSK, i18n, NOW)).toBe('Kavana Velebit · Donji grad · 10 minuta');
  });
  it('names the other person’s phone and its five minutes', () => {
    expect(confirmLabel(PHONE, i18n, NOW)).toBe('Telefon druge osobe · 5 minuta');
  });
  it('drops a missing district instead of leaving a hole', () => {
    expect(confirmLabel({ ...KIOSK, area: null }, i18n, NOW)).toBe('Kavana Velebit · 10 minuta');
  });
  it('falls back to the kind of screen, in sentence case, when the operator gave it no label', () => {
    expect(confirmLabel({ ...KIOSK, screenLabel: null }, i18n, NOW)).toBe('Kafić · Donji grad · 10 minuta');
    expect(confirmLabel({ ...KIOSK, screenLabel: null, venueType: null }, i18n, NOW)).toBe('Javni zaslon · Donji grad · 10 minuta');
    expect(confirmLabel({ ...KIOSK, screenLabel: null, venueType: 'zet' }, i18n, NOW)).toBe('ZET · Donji grad · 10 minuta');
  });
  it('never rounds below one minute (the expiry spec’s "1 minuta")', () => {
    expect(confirmLabel({ ...PHONE, expiresAt: NOW + 12_000 }, i18n, NOW)).toBe('Telefon druge osobe · 1 minuta');
  });
  it('reads the same shape in English', () => {
    const en = createDefaultI18n('en');
    expect(confirmLabel(KIOSK, en, NOW)).toBe('Kavana Velebit · Donji grad · 10 minutes');
    expect(confirmLabel({ ...KIOSK, screenLabel: null }, en, NOW)).toBe('Café · Donji grad · 10 minutes');
    expect(confirmLabel(PHONE, en, NOW)).toBe("Another person's phone · 5 minutes");
  });
});

describe('dashboardUrl', () => {
  it('puts room, ticket and a label in the fragment, never in the query', () => {
    expect(dashboardUrl(KIOSK)).toBe('/d/#room=r1&ticket=t1&label=Kavana%20Velebit');
    // A kind is never a label: a peer's fragment carries no label at all, and the pill says whose minutes these are (session.joinedPeer).
    expect(dashboardUrl(PHONE)).toBe('/d/#room=r2&ticket=t2');
  });
});

beforeEach(() => {
  document.body.innerHTML = '';
});

function mount(options: {
  hash?: string;
  result?: ScanOk | ScanFail;
  scan?: (code: string) => Promise<ScanOk | ScanFail>;
  now?: () => number;
  readClipboard?: () => Promise<string>;
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
    now: options.now ?? (() => NOW),
    scan,
    readClipboard: options.readClipboard,
  });
  const input = root.querySelector<HTMLInputElement>('[data-testid=code-input]')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const submitButton = root.querySelector<HTMLButtonElement>('[data-testid=code-submit]')!;
  const status = root.querySelector<HTMLElement>('[data-testid=scan-status]')!;
  const errorBox = root.querySelector<HTMLElement>('.scan-error')!;
  const type = (value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const send = (): void => {
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  return { root, handle, navigate, replaceUrl, scan, input, form, submitButton, status, errorBox, type, send };
}

describe('clipboard paste', () => {
  it.each(['ABCD-EFGH', 'https://zagreb.aningfilm.hr/s/#ABCD-EFGH'])('fills a copied code or scan link without submitting: %s', async (value) => {
    const page = mount({ readClipboard: async () => value });
    page.root.querySelector<HTMLButtonElement>('[data-testid=code-paste]')!.click();
    await flush();
    expect(page.input.value).toBe('ABCD-EFGH');
    expect(page.submitButton.disabled).toBe(false);
    expect(page.scan).not.toHaveBeenCalled();
  });
  it('preserves manual entry when clipboard access is denied', async () => {
    const page = mount({ readClipboard: async () => { throw new Error('denied'); } });
    page.type('ABCD');
    page.root.querySelector<HTMLButtonElement>('[data-testid=code-paste]')!.click();
    await flush();
    expect(page.input.value).toBe('ABCD');
    expect(page.status.textContent).toContain('Zalijepi kod izravno');
    expect(document.activeElement).toBe(page.input);
    page.type('ABCD-EFGH');
    expect(page.submitButton.disabled).toBe(false);
  });
});

const ERRORS: [ScanFail['error'], string][] = [
  ['bad-request', 'Kod nije u ispravnom obliku.'],
  ['code-unknown', 'Taj kod ne postoji ili je prošao. Pogledaj zaslon i skeniraj ponovno.'],
  ['code-expired', 'Kod je istekao. Zaslon već pokazuje novi.'],
  ['code-used', 'Taj je kod već iskorišten. Pričekaj novi na zaslonu.'],
  ['screen-offline', 'Zaslon je trenutačno bez veze. Pokušaj za minutu.'],
  ['same-network', 'Ovaj kod trenutačno nije moguće iskoristiti s ove veze. Skeniraj ponovno.'],
  ['slow-down', 'Previše pokušaja. Pričekaj minutu.'],
  ['rate-limited', 'Previše pokušaja s ove mreže. Pričekaj minutu.'],
  ['revoked', 'Ovaj je zaslon isključen.'],
];

interface FakeScanner extends QrScannerHandle {
  deps: QrScannerDeps;
  started: number;
  destroyed: number;
}

function mountWithCamera(options: {
  result?: ScanOk | ScanFail;
  scan?: (code: string) => Promise<ScanOk | ScanFail>;
  failStart?: 'denied' | 'unavailable';
} = {}) {
  const root = document.createElement('main');
  document.body.appendChild(root);
  const navigate = vi.fn();
  const scan = vi.fn(options.scan ?? (async () => options.result ?? KIOSK));
  let scanner: FakeScanner | null = null;
  const handle = createScanPage(root, {
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
      // The real viewfinder's Odustani, the button the page hands focus to.
      element.innerHTML = '<button type="button" class="btn-ghost qr-scanner-cancel" data-qr-scan-cancel>Odustani</button>';
      const fake: FakeScanner = {
        deps,
        started: 0,
        destroyed: 0,
        element,
        start: async () => {
          fake.started += 1;
          // The real start() reports a failure through onError and then resolves.
          if (options.failStart) deps.onError?.(options.failStart);
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
  const status = root.querySelector<HTMLElement>('[data-testid=scan-status]')!;
  return { root, handle, button, region, input, status, scan, scanner: () => scanner!, navigate };
}

describe('createScanPage', () => {
  it('always offers the typed code, with the alphabet warning and no camera by default', () => {
    const { root } = mount();
    expect(root.querySelector('h1')?.textContent).toBe('Otključaj pogled na Zagreb');
    expect(root.querySelector('[data-testid=code-input]')).not.toBeNull();
    expect(text(root.querySelector('#scan-hint'))).toBe('Osam znakova, npr. ABCD-EFGH. Slova I, L i O ne postoje: upiši 1 ili 0.');
    expect(root.querySelector('[data-testid=scan-camera]')).toBeNull();
    expect(root.querySelector('.scan-or')).toBeNull();
    expect(root.querySelector('[data-testid=scan-error]')?.getAttribute('role')).toBe('alert');
    expect(root.querySelector('[data-testid=scan-status]')?.getAttribute('role')).toBe('status');
  });

  it('puts the field first, then the intro and a quiet path for arrivals without a code', () => {
    const { root } = mountWithCamera();
    const selectors = [
      'h1',
      '[data-testid=scan-camera-region]',
      '.scan-label',
      '[data-testid=code-input]',
      '.scan-error',
      '#scan-hint',
      '[data-testid=code-submit]',
      '.scan-or',
      '[data-testid=scan-camera]',
      '[data-testid=scan-status]',
      '.scan-intro',
      '.scan-no-code',
    ];
    const nodes = selectors.map((selector) => root.querySelector(selector));
    nodes.forEach((node, i) => expect(node, selectors[i]).not.toBeNull());
    for (let i = 1; i < nodes.length; i += 1) {
      expect(before(nodes[i - 1]!, nodes[i]!), `${selectors[i - 1]} must precede ${selectors[i]}`).toBe(true);
    }
    // The recovery path does not interrupt typing or the camera flow.
    expect(root.querySelector('.scan-error')!.previousElementSibling).toBe(root.querySelector('[data-testid=code-input]'));
    expect(root.querySelector('.scan')!.lastElementChild).toBe(root.querySelector('.scan-no-code'));
    expect(root.querySelector('[data-testid=scan-no-code]')?.getAttribute('href')).toBe('/#isprobaj');
    expect(text(root.querySelector('.scan-intro'))).toBe('Skeniraj QR kod ili upiši kod sa zaslona. Deset minuta sa zaslona, pet s telefona druge osobe.');
    expect(text(root.querySelector('.scan-label'))).toBe('Kod sa zaslona');
    expect(root.querySelector<HTMLLabelElement>('.scan-label')!.htmlFor).toBe('scan-code');
  });

  it('asks the keyboard for capitals, no suggestions and a Go key, and describes the field by its hint', () => {
    const { input } = mount();
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('enterkeyhint')).toBe('go');
    expect(input.getAttribute('maxlength')).toBe('9');
    expect(input.getAttribute('placeholder')).toBe('ABCD-EFGH');
    expect(input.getAttribute('aria-describedby')).toBe('scan-hint');
  });

  it('takes focus on load only when no code came in the fragment', () => {
    expect(mount().input.hasAttribute('autofocus')).toBe(true);
    expect(mount({ hash: '#ABCD-EFGH' }).input.hasAttribute('autofocus')).toBe(false);
  });

  it('the check is the primary action and the camera a ghost of the same height', () => {
    const { root } = mountWithCamera();
    expect(root.querySelector('[data-testid=code-submit]')!.className).toBe('btn btn-primary');
    expect(text(root.querySelector('[data-testid=code-submit]'))).toBe('Provjeri kod');
    expect(root.querySelector('[data-testid=scan-camera]')!.classList.contains('btn-ghost')).toBe(true);
    expect(text(root.querySelector('.scan-or'))).toBe('ili');
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

  it('redeems the fragment once, removes the code and opens the granted session directly', async () => {
    const { root, scan, replaceUrl, navigate, form } = mount({ hash: '#ABCD-EFGH' });
    await flush();
    expect(scan).toHaveBeenCalledWith('ABCDEFGH');
    // No confirm card and no second "unlock" decision: the redemption is the grant (WP5 A3).
    expect(root.querySelector('[data-testid=confirm-card]')).toBeNull();
    expect(root.querySelector('[data-testid=unlock]')).toBeNull();
    expect(form.hidden).toBe(true);
    expect(navigate).toHaveBeenCalledWith(dashboardUrl(KIOSK));
    expect(replaceUrl).toHaveBeenCalledWith('/s/');
  });

  it('keeps the granted screen identity while navigating directly', async () => {
    const { status, navigate } = mount({ hash: '#ABCD-EFGH', result: AT_STOP });
    await flush();
    expect(text(status)).toBe('Kavana Velebit · Donji grad · 10 minuta');
    expect(navigate).toHaveBeenCalledWith(dashboardUrl(AT_STOP));
  });

  it('names a peer’s phone with its own five minutes (the pairing spec’s "5 minuta")', async () => {
    const { status, navigate } = mount({ hash: '#ABCD-EFGH', result: PHONE });
    await flush();
    expect(text(status)).toBe('Telefon druge osobe · 5 minuta');
    expect(navigate).toHaveBeenCalledWith(dashboardUrl(PHONE));
  });

  it('navigates only once even if submit is repeated after success', async () => {
    const { handle, navigate, scan } = mount({ hash: '#ABCD-EFGH' });
    await flush();
    await handle.submit('ABCD-EFGH');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/d/#room=r1&ticket=t1&label=Kavana%20Velebit');
  });

  it('successful redemption introduces no second unlock or cancel decision', async () => {
    const { root, form } = mount({ hash: '#ABCD-EFGH' });
    await flush();
    expect(root.querySelector('[data-testid=confirm-card]')).toBeNull();
    expect(root.querySelector('[data-testid=confirm-cancel]')).toBeNull();
    expect(form.hidden).toBe(true);
  });

  it.each(ERRORS)('shows the Croatian sentence for %s, drops the spent code from the address bar and keeps the field usable', async (error, message) => {
    const { root, input, replaceUrl, errorBox } = mount({ hash: '#ABCD-EFGH', result: { error, message: 'server text' } });
    await flush();
    expect(text(root.querySelector('[role=alert]'))).toBe(message);
    expect(errorBox.hidden).toBe(false);
    // A pull-to-refresh after the failure must not resubmit: the fragment is empty.
    expect(replaceUrl).toHaveBeenCalledWith('/s/');
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    expect(input.hasAttribute('aria-busy')).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('scan-hint scan-error');
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('[data-testid=confirm-card]')).toBeNull();
  });

  it('maps the client-side network failure to the network sentence, with no action', async () => {
    const { root, errorBox } = mount({ hash: '#ABCD-EFGH', result: { error: 'bad-request', message: 'network' } });
    await flush();
    expect(text(root.querySelector('[role=alert]'))).toBe('Nema veze s poslužiteljem. Provjeri mrežu i pokušaj ponovno.');
    expect(errorBox.querySelector('button, a')).toBeNull();
  });

  it('falls back to the server sentence for an error the catalog does not know', async () => {
    const unknown = { error: 'teapot', message: 'Nešto posve novo.' } as unknown as ScanFail;
    const { root, errorBox } = mount({ hash: '#ABCD-EFGH', result: unknown });
    await flush();
    expect(text(root.querySelector('[role=alert]'))).toBe('Nešto posve novo.');
    expect(errorBox.querySelector('button, a')).toBeNull();
  });

  it('refuses an incomplete typed code without touching the network or the address bar', async () => {
    const { root, scan, input, replaceUrl, errorBox, type, send } = mount();
    type('ABC');
    send();
    await flush();
    expect(scan).not.toHaveBeenCalled();
    expect(replaceUrl).not.toHaveBeenCalled();
    expect(text(root.querySelector('[role=alert]'))).toBe('Kod nije potpun. Upiši svih osam znakova.');
    expect(errorBox.querySelector('button, a')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('keeps the keyboard during the check: the field is read-only and busy, never disabled; the check reads Provjera', async () => {
    let release!: (value: ScanOk) => void;
    const pending = new Promise<ScanOk>((resolve) => {
      release = resolve;
    });
    const { root, scan, input, submitButton, type, send } = mount({ scan: () => pending });
    type('ABCD-EFGH');
    send();
    send();
    await flush();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(text(root.querySelector('[data-testid=scan-status]'))).toBe('Provjera koda');
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-busy')).toBe('true');
    expect(submitButton.disabled).toBe(true);
    expect(text(submitButton)).toBe('Provjera');
    release(KIOSK);
    await flush();
    expect(text(root.querySelector('[data-testid=scan-status]'))).toContain('Kavana Velebit');
    expect(input.readOnly).toBe(false);
    expect(input.hasAttribute('aria-busy')).toBe(false);
    expect(text(submitButton)).toBe('Provjeri kod');
    expect(root.querySelector('[data-testid=confirm-card]')).toBeNull();
  });

  it('destroy() takes the section off the page', () => {
    const { root, handle } = mount();
    handle.destroy();
    expect(root.querySelector('.scan')).toBeNull();
  });
});

// After the sentence, one thing the person can do, chosen by the code: a fresh
// code, the safety layer that needs none, or a minute's wait. Errors that
// need nothing but the sentence get nothing else.
describe('one recovery per error', () => {
  it.each(['code-used', 'code-expired', 'code-unknown'] as const)('%s offers Upiši novi kod, which empties and focuses the field', async (error) => {
    const { input, submitButton, errorBox } = mount({ hash: '#ABCD-EFGH', result: { error, message: '' } });
    await flush();
    const retype = errorBox.querySelector<HTMLButtonElement>('button[data-testid=scan-retype]')!;
    expect(retype).not.toBeNull();
    expect(text(retype)).toBe('Upiši novi kod');
    expect(retype.classList.contains('btn-ghost')).toBe(true);
    expect(errorBox.querySelector('a')).toBeNull();
    expect(input.value).toBe('ABCD-EFGH');
    input.blur();
    retype.click();
    expect(input.value).toBe('');
    expect(submitButton.disabled).toBe(true);
    expect(errorBox.hidden).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it.each(['screen-offline', 'revoked'] as const)('%s points to Sigurnost, which needs no code', async (error) => {
    const { errorBox } = mount({ hash: '#ABCD-EFGH', result: { error, message: '' } });
    await flush();
    const link = errorBox.querySelector<HTMLAnchorElement>('a[data-testid=scan-safety]')!;
    expect(link).not.toBeNull();
    expect(text(link)).toBe('Sigurnost, bez skeniranja');
    expect(link.getAttribute('href')).toBe('/hitno');
    expect(link.classList.contains('btn-ghost')).toBe(true);
    expect(errorBox.querySelector('button')).toBeNull();
  });

  it.each([
    ['slow-down', 'Previše pokušaja. Pričekaj minutu.'],
    ['rate-limited', 'Previše pokušaja s ove mreže. Pričekaj minutu.'],
  ] as const)('%s counts a minute down in the status line and re-enables the check at zero', async (error, sentence) => {
    vi.useFakeTimers({ now: NOW });
    try {
      const { root, handle, scan, input, submitButton, status, errorBox, type, send } = mount({ result: { error, message: '' }, now: () => Date.now() });
      type('ABCD-EFGH');
      send();
      await flush();
      expect(text(root.querySelector('[role=alert]'))).toBe(sentence);
      expect(errorBox.querySelector('button, a')).toBeNull();
      expect(text(status)).toBe('Pokušaj ponovno za 01:00');
      expect(submitButton.disabled).toBe(true);
      expect(input.readOnly).toBe(false);
      expect(document.activeElement).toBe(input);
      vi.advanceTimersByTime(1000);
      expect(text(status)).toBe('Pokušaj ponovno za 00:59');
      // Neither typing nor submitting during the wait reaches the Worker.
      type('ABCD-EFGH');
      expect(submitButton.disabled).toBe(true);
      send();
      await flush();
      expect(scan).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(58_000);
      expect(text(status)).toBe('Pokušaj ponovno za 00:01');
      expect(submitButton.disabled).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(text(status)).toBe('');
      expect(submitButton.disabled).toBe(false);
      send();
      await flush();
      expect(scan).toHaveBeenCalledTimes(2);
      // A second wait is cut short by destroy(): nothing ticks on a detached page.
      expect(text(status)).toBe('Pokušaj ponovno za 01:00');
      handle.destroy();
      expect(text(status)).toBe('');
      vi.advanceTimersByTime(60_000);
      expect(root.querySelector('.scan')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['same-network', 'bad-request'] as const)('%s has nothing beyond the sentence', async (error) => {
    const { status, errorBox } = mount({ hash: '#ABCD-EFGH', result: { error, message: '' } });
    await flush();
    expect(errorBox.querySelector('button, a')).toBeNull();
    expect(text(status)).toBe('');
  });
});

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

  it('opening the viewfinder brings it into view, hands focus to Odustani and says what the camera is doing', async () => {
    const { root, button, region, status, scanner } = mountWithCamera();
    const scroll = vi.fn();
    region.scrollIntoView = scroll;
    button.click();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(before(region, root.querySelector('form')!)).toBe(true);
    expect(text(status)).toBe('Kamera se uključuje');
    expect(document.activeElement).toBe(scanner().element.querySelector('[data-qr-scan-cancel]'));
    await flush();
    expect(text(status)).toBe('Kamera je uključena.');
    scanner().deps.onCancel?.();
    expect(text(status)).toBe('');
  });

  it('a camera that fails to start leaves no camera word in the status line', async () => {
    const { root, button, status, input } = mountWithCamera({ failStart: 'denied' });
    button.click();
    await flush();
    expect(text(status)).toBe('');
    expect(text(root.querySelector('[role=alert]'))).toBe('Pristup kameri je odbijen. Upiši kod ručno.');
    expect(document.activeElement).toBe(input);
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

  it('a foreign QR code is named as such instead of being posted, with no action', async () => {
    const { root, button, scan, scanner } = mountWithCamera();
    button.click();
    scanner().deps.onResult('WIFI:S:kafic;T:WPA;P:tajna;;');
    await flush();
    expect(scan).not.toHaveBeenCalled();
    expect(text(root.querySelector('[role=alert]'))).toBe('To nije kod s našeg zaslona. Skeniraj QR kod sa zaslona ili upiši osam slova.');
    expect(root.querySelector('.scan-error button, .scan-error a')).toBeNull();
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

  it('the camera button rests while a code is being checked', async () => {
    let release!: (value: ScanOk) => void;
    const pending = new Promise<ScanOk>((resolve) => {
      release = resolve;
    });
    const { root, button, input, handle } = mountWithCamera({ scan: () => pending });
    input.value = 'ABCD-EFGH';
    void handle.submit(input.value);
    await flush();
    expect(button.disabled).toBe(true);
    release(KIOSK);
    await flush();
    expect(button.disabled).toBe(false);
    expect(root.querySelector('[data-testid=confirm-card]')).toBeNull();
  });
});

// The stylesheet composes the page in the signage roles: the h1 at display,
// the hint at secondary, the intro at control; the
// actions stack full width; the error box is the urgency tint at body size.
describe('scan.css composes the page in the type roles', () => {
  const CSS = stripComments(read('app', 'src', 'ui', 'scan.css'));

  it('stacks the actions full width instead of a three-column row, both at the primary height', () => {
    const actions = ruleBody(CSS, /^\.scan-actions\s*\{/m);
    expect(actions).toMatch(/display:\s*grid/);
    expect(actions).not.toMatch(/grid-template-columns/);
    expect(CSS).not.toContain('.scan-actions--single');
    expect(ruleBody(CSS, /^\.scan-actions \.btn-ghost\s*\{/m)).toMatch(/min-height:\s*var\(--target-primary\)/);
  });

  it('tints the error box with the urgency role at body size and hides it explicitly', () => {
    const box = ruleBody(CSS, /^\.scan-error\s*\{/m);
    expect(box).toMatch(/background:\s*var\(--tone-tint-urgency\)/);
    expect(box).toMatch(/font-size:\s*var\(--type-body\)/);
    expect(CSS).toMatch(/^\.scan-error\[hidden\]\s*\{\s*display:\s*none;?\s*\}/m);
  });

  it('sets the h1 at display, the hint at secondary and the intro at control; the confirm card left with its rules', () => {
    expect(ruleBody(CSS, /^\.scan-title\s*\{/m)).toMatch(/font-size:\s*var\(--type-display\)/);
    expect(CSS).not.toContain('.scan-confirm');
    expect(ruleBody(CSS, /^\.scan-hint\s*\{/m)).toMatch(/font-size:\s*var\(--type-secondary\)/);
    expect(ruleBody(CSS, /^\.scan-intro\s*\{/m)).toMatch(/font-size:\s*var\(--type-control\)/);
  });

  it('uses no viewport height units and no !important', () => {
    expect(CSS).not.toMatch(/\d(vh|svh|dvh)\b/);
    expect(CSS).not.toMatch(/!important/);
  });
});

// Reproduces the review finding on scan.css vs base.css: a bare `.scan-input`
// (specificity 0,1,0) loses every contested longhand to the generic
// `input[type='text'], select` reset in base.css (0,1,1) — border, min-height,
// font-family and font-size all silently fall back to the base rule's values
// regardless of file/import order, since there is no @layer, !important or
// :where() anywhere in the codebase. This computes real CSS specificity
// (a, b, c) from the selector text so the check keeps holding for whatever
// selector shape the fix takes, not just today's exact string.
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
  const BASE_CSS = stripComments(read('app', 'src', 'ui', 'base.css'));
  const SCAN_CSS = stripComments(read('app', 'src', 'ui', 'scan.css'));

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
    // scan.css is linked after base.css (app/s/index.html), so an exact tie
    // would still win on source order — but only a strictly higher
    // specificity is robust to that link order ever changing.
    expect(cmp(scanSpec, baseSpec), `.scan-input selector "${scanSel}" must out-specify "input[type='text']"`).toBeGreaterThan(0);
  });

  it('the contested longhands are set directly on the .scan-input rule, not left to the generic reset: a 56 px field with 28 px mono type', () => {
    const start = SCAN_CSS.indexOf(scanInputSelector());
    const body = SCAN_CSS.slice(start, SCAN_CSS.indexOf('}', start) + 1);
    expect(body).toMatch(/border-width:\s*2px/);
    expect(body).toMatch(/border-style:\s*solid/);
    expect(body).toMatch(/min-height:\s*3\.5rem/);
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

  // The entry imports base.css and signage.css again (the signage contract in
  // test/app/signage-css.test.ts). In the build that is one copy of each,
  // linked before scan.css; in Vite's dev server the imported copy paints a
  // second time, after scan.css. So no rule in scan.css may rely on following
  // base.css at equal specificity. Two rules contest `color` with a base hover
  // rule of the weight their bare form would have: the wordmark's `color:
  // inherit` against `a:hover` (0,1,1) and the footer ghost's urgency colour
  // against `.btn-ghost:hover` (0,2,0). Both out-specify the base rule instead.
  it("the wordmark link and the footer's urgency ghost out-specify base.css's hover rules, so their colour never depends on sheet order", () => {
    const selectorOf = (rule: string): string => rule.slice(0, rule.indexOf('{')).trim();
    const brandRule = ruleBody(SCAN_CSS, /^[^{}]*\.scan-brand[^{}]* a\s*\{/m);
    const footRule = ruleBody(SCAN_CSS, /^[^{}]*\.scan-foot[^{}]*\.btn-ghost\s*\{/m);
    // Sanity: both rules really do set color, and base.css really does carry the two hover rules that set it.
    expect(declaredProperties(brandRule)).toContain('color');
    expect(declaredProperties(footRule)).toContain('color');
    expect(BASE_CSS).toMatch(/^\s*a:hover\s*\{[^}]*\bcolor:/m);
    expect(BASE_CSS).toMatch(/^\s*\.btn-ghost:hover\s*\{[^}]*\bcolor:/m);
    const brand = selectorOf(brandRule);
    const foot = selectorOf(footRule);
    expect(cmp(specificity(brand), specificity('a:hover')), `"${brand}" must out-specify "a:hover"`).toBeGreaterThan(0);
    expect(cmp(specificity(foot), specificity('.btn-ghost:hover')), `"${foot}" must out-specify ".btn-ghost:hover"`).toBeGreaterThan(0);
  });
});

describe('the brand link on /s/ is a 44 px target', () => {
  it('p.scan-brand a is an inline-flex box at least --target tall (the production audit measured it at 22 px)', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'scan.css'), 'utf8');
    expect(css).toContain('p.scan-brand a { display: inline-flex; align-items: center; min-block-size: var(--target);');
  });
});
