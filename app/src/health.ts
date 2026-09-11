// Landing-page status line: shows the Worker version and time from /api/health.
// Lives in a file (not inline) so the strict CSP (script-src 'self') allows it.
const el = document.getElementById('health');
if (el) {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = (await r.json()) as { ok?: boolean; version?: string; time?: string };
    el.textContent = j.ok
      ? `worker ${j.version} · ${new Date(j.time ?? Date.now()).toLocaleTimeString('hr-HR')}`
      : 'greška';
  } catch {
    el.textContent = 'nedostupno';
  }
}

export {};
