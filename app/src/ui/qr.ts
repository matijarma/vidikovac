// Renders a payload (pairing invite link/token) to an inline SVG QR code via
// `uqr` (replaces v1's `qrious` canvas-based renderer — no <canvas>, so this
// works identically in the extension popup / any non-DOM-canvas context,
// and the SVG scales losslessly). Falls back to a plain-text code block if
// generation throws (bad payload, no viable QR version, etc.) so pairing
// never gets fully blocked by a rendering failure.
import { renderSVG } from 'uqr';
import { escapeAttribute, escapeHtml, createElementFromHTML } from './dom/escape';

export interface QrOptions {
  payload: string;
  /** aria-label for the rendered QR (role="img"). */
  ariaLabel: string;
  /** Shown instead of the QR if generation fails or the payload is empty. */
  unavailableText: string;
  /** Empty modules round the code inside the SVG (uqr's `border`): 1 by default, as every surface has
   *  drawn it; the public screen asks for the standard's 4 so a camera finds the code from 3 m (round 2, F7). */
  quietZoneModules?: number;
}

export interface QrHandle {
  readonly element: HTMLElement;
  readonly isFallback: boolean;
}

export function createQr(options: QrOptions): QrHandle {
  const payload = options.payload.trim();
  if (!payload) {
    return renderFallback(options);
  }

  try {
    const svg = renderSVG(payload, {
      ecc: 'M',
      blackColor: 'currentColor',
      whiteColor: 'transparent',
      border: options.quietZoneModules ?? 1,
    });
    const element = createElementFromHTML(
      `<div class="qr" role="img" aria-label="${escapeAttribute(options.ariaLabel)}">${svg}</div>`,
    );
    return { element, isFallback: false };
  } catch {
    return renderFallback(options);
  }
}

function renderFallback(options: QrOptions): QrHandle {
  const element = createElementFromHTML(
    `<div class="qr qr-fallback">
      <p class="qr-fallback-text">${escapeHtml(options.unavailableText)}</p>
      <code class="qr-payload">${escapeHtml(options.payload)}</code>
    </div>`,
  );
  return { element, isFallback: true };
}
