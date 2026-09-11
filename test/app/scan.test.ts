// @vitest-environment happy-dom
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
