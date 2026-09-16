/* Kaj ima? · pisani prijedlog: the document's small behaviours. Everything the
   document says is in the HTML; this adds the Zagreb clock, the theme control
   (same preference key as the app), the rotating demo code, a compressed
   session-expiry demo, the contents scrollspy and, on the app's own origin,
   a refresh of the "Sada u Zagrebu" tiles from the open teaser endpoint.
   Plain script, no imports, no dependencies: it runs inline from a file on
   disk and as a module under the app's CSP (script-src 'self'). */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var $ = function (sel, el) { return (el || doc).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Sun times: a port of app/src/ui/solar.ts (the standard sunrise equation). ---
  var ZAGREB = { lat: 45.815, lon: 15.98 };
  var DEG = Math.PI / 180, J2000 = 2451545.0, UNIX_JD = 2440587.5, DAY = 86400000;
  function sinD(d) { return Math.sin(d * DEG); }
  function cosD(d) { return Math.cos(d * DEG); }
  function mod360(x) { return ((x % 360) + 360) % 360; }
  function sunTimes(date) {
    var dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    var n = Math.ceil(dayStart / DAY + UNIX_JD - J2000 + 0.0008);
    var mst = n - ZAGREB.lon / 360;
    var M = mod360(357.5291 + 0.98560028 * mst);
    var C = 1.9148 * sinD(M) + 0.02 * sinD(2 * M) + 0.0003 * sinD(3 * M);
    var L = mod360(M + C + 180 + 102.9372);
    var transitJ = J2000 + mst + 0.0053 * sinD(M) - 0.0069 * sinD(2 * L);
    var decl = Math.asin(sinD(L) * sinD(23.4397)) / DEG;
    var cosH = (sinD(-0.833) - sinD(ZAGREB.lat) * sinD(decl)) / (cosD(ZAGREB.lat) * cosD(decl));
    var fromJ = function (j) { return new Date(Math.round((j - UNIX_JD) * DAY)); };
    if (cosH >= 1 || cosH <= -1) { var t = fromJ(transitJ); return { sunrise: t, sunset: t }; }
    var H = Math.acos(cosH) / DEG;
    return { sunrise: fromJ(transitJ - H / 360), sunset: fromJ(transitJ + H / 360) };
  }

  var timeFmt;
  try { timeFmt = new Intl.DateTimeFormat('hr-HR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zagreb' }); } catch (e) { timeFmt = null; }
  function hhmm(d) {
    if (!timeFmt) return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return timeFmt.format(d).replace(/^24/, '00');
  }

  // --- Clock and sunset in the status line ------------------------------------
  function tickClock() {
    var el = $('#ds-clock');
    if (!el) return;
    var now = new Date();
    el.textContent = hhmm(now);
    el.setAttribute('datetime', now.toISOString());
  }
  function setSun() {
    var el = $('#ds-sunset');
    if (el) el.textContent = hhmm(sunTimes(new Date()).sunset);
  }

  // --- Theme: auto | light | dark | solar, the app's key ----------------------
  var THEME_KEY = 'vidikovac-theme';
  var PREFS = ['auto', 'light', 'dark', 'solar'];
  function store() { try { return window.localStorage; } catch (e) { return null; } }
  function readPref() {
    var s = store();
    var v = s && s.getItem(THEME_KEY);
    return PREFS.indexOf(v) >= 0 ? v : 'auto';
  }
  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    if (pref === 'solar') {
      var t = sunTimes(new Date()), now = Date.now();
      return now >= t.sunrise.getTime() && now < t.sunset.getTime() ? 'light' : 'dark';
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var currentPref = 'auto';
  function applyTheme(pref) {
    currentPref = pref;
    root.setAttribute('data-theme-resolved', resolveTheme(pref));
    root.setAttribute('data-theme', pref);
    $$('[data-theme-pref]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-pref') === pref)); });
  }
  function bindTheme() {
    $$('[data-theme-pref]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pref = b.getAttribute('data-theme-pref');
        var s = store();
        if (s) { try { s.setItem(THEME_KEY, pref); } catch (e) { /* private mode */ } }
        applyTheme(pref);
      });
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (currentPref === 'auto') applyTheme('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
    setInterval(function () { if (currentPref === 'solar') applyTheme('solar'); }, 60000);
  }

  // --- The rotating demo code: eight Crockford base32 characters per 30 s slot --
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function demoCode(slot) {
    var x = (slot * 2654435761) >>> 0, out = '';
    for (var i = 0; i < 8; i++) {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      out += ALPHABET[x % 32];
    }
    return out;
  }
  function tickCode() {
    var el = $('#invite-code');
    if (!el) return;
    var now = Date.now(), slot = Math.floor(now / 30000);
    if (el.getAttribute('data-slot') !== String(slot)) {
      var code = demoCode(slot);
      el.setAttribute('data-slot', String(slot));
      el.textContent = '';
      el.appendChild(doc.createTextNode(code.slice(0, 4)));
      var dot = doc.createElement('span'); dot.className = 'dot'; dot.textContent = '·';
      el.appendChild(dot);
      el.appendChild(doc.createTextNode(code.slice(4)));
      el.setAttribute('aria-label', 'Prikaz koda ' + code.slice(0, 4) + ' ' + code.slice(4));
    }
    var remaining = 30000 - (now % 30000);
    var bar = $('#invite-bar');
    if (bar) bar.style.setProperty('--p', (remaining / 30000 * 100).toFixed(1) + '%');
    var rem = $('#invite-remaining');
    if (rem) rem.textContent = Math.ceil(remaining / 1000) + ' s';
  }

  // --- Session demo: ten minutes compressed into sixty seconds -----------------
  var demoTimer = null;
  function setSession(state, urgency, text) {
    var pill = $('#ds-session');
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (urgency) pill.setAttribute('data-urgency', urgency); else pill.removeAttribute('data-urgency');
    var t = $('#ds-session-text');
    if (t) t.textContent = text;
  }
  function startDemo(btn) {
    var live = $('#live'), status = $('#demo-status'), ring = $('#ds-ring');
    if (!live || !ring) return;
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    live.removeAttribute('data-frozen');
    $$('#live-lane .tl-context, #live-lane .tl-trail').forEach(function (c) { c.removeAttribute('data-frozen'); });
    var when = $('#live-when');
    var whenText = when ? when.textContent : '';
    var start = Date.now(), total = 60000;
    btn.disabled = true;
    btn.textContent = 'Prikaz isteka sesije traje';
    if (status) status.textContent = 'Deset minuta sesije prikazano u šezdeset sekundi.';
    var step = function () {
      var left = Math.max(0, total - (Date.now() - start));
      var frac = left / total;
      ring.setAttribute('stroke-dasharray', (frac * 100).toFixed(1) + ' 100');
      var secs = Math.ceil(left / 1000);
      if (left <= 0) {
        clearInterval(demoTimer); demoTimer = null;
        setSession('frozen', null, 'Sesija je završila · prikaz zamrznut');
        live.setAttribute('data-frozen', '1');
        if (when) when.textContent = 'podaci od ' + hhmm(new Date()) + ' · ' + whenText;
        if (status) status.textContent = 'Prikaz stoji na posljednjim podacima; kopiranje i preuzimanje i dalje rade. Sigurnost ostaje otvorena na /hitno.';
        btn.disabled = false;
        btn.textContent = 'Ponovi prikaz isteka sesije (60 s)';
        return;
      }
      if (left <= 2000) setSession('open', 'alert', 'Još dvadeset sekundi.');
      else if (left <= 6000) setSession('open', 'warn', 'Još minuta. Ono što gledaš ostaje.');
      else setSession('open', null, 'Prikaz sesije · još ' + secs + ' s');
    };
    step();
    demoTimer = setInterval(step, reduced ? 1000 : 250);
  }

  // --- Scrollspy for the contents bar ---------------------------------------
  function bindScrollspy() {
    var links = $$('#toc .toc-link');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('data-target')] = a; });
    var sections = links.map(function (a) { return doc.getElementById(a.getAttribute('data-target')); }).filter(Boolean);
    var current = null;
    var setCurrent = function (id) {
      if (current === id) return;
      current = id;
      links.forEach(function (a) { if (a.getAttribute('data-target') === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      var a = byId[id];
      if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
    };
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting ? e.boundingClientRect.top : null; });
      var best = null, bestTop = Infinity;
      sections.forEach(function (s) {
        var top = visible[s.id];
        if (top !== null && top !== undefined && Math.abs(top) < bestTop) { bestTop = Math.abs(top); best = s.id; }
      });
      if (!best) {
        // Nothing intersecting: the section whose top is nearest above the fold.
        var nearest = null, nearestTop = -Infinity;
        sections.forEach(function (s) { var r = s.getBoundingClientRect(); if (r.top <= 120 && r.top > nearestTop) { nearestTop = r.top; nearest = s.id; } });
        best = nearest;
      }
      if (best) setCurrent(best);
    }, { rootMargin: '-96px 0px -60% 0px', threshold: [0, 0.01] });
    sections.forEach(function (s) { io.observe(s); });
  }

  // --- Live refresh on the app's own origin (no CORS elsewhere) ---------------
  function num(s) { var m = /\d+/.exec(String(s || '')); return m ? parseInt(m[0], 10) : null; }
  function hrNumber(n, digits) {
    try { return new Intl.NumberFormat('hr-HR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n); }
    catch (e) { return String(n).replace('.', ','); }
  }
  function setText(id, text) { var el = doc.getElementById(id); if (el && text != null) el.textContent = text; }
  function setValue(id, main, unit) {
    var el = doc.getElementById(id);
    if (!el || main == null) return;
    el.textContent = '';
    el.appendChild(doc.createTextNode(main + (unit ? ' ' : '')));
    if (unit) { var u = doc.createElement('span'); u.className = 'tl-unit'; u.textContent = unit; el.appendChild(u); }
  }
  function applyTeaser(t) {
    var mods = {};
    (t.modules || []).forEach(function (m) { mods[m.module] = m; });
    var now = Date.now();
    var m;
    if ((m = mods['zet-rt']) && m.items && m.items.length) {
      var n = num(m.items[0].title);
      if (n != null) { setValue('tile-transit-value', String(n), 'vozila'); setText('tile-transit-ctx', 'u pokretu na mreži ZET-a · ' + hhmm(new Date(m.sourceUpdatedAt || m.fetchedAt || now))); }
    }
    if ((m = mods.prometnice) && m.items) setText('tile-closures-value', String(m.items.length));
    if ((m = mods['dhmz-now']) && m.items && m.items[0]) {
      var it = m.items[0];
      var temp = it.data && typeof it.data.temp === 'number' ? it.data.temp : null;
      if (temp != null) setValue('tile-weather-value', hrNumber(temp, 1), '°C');
      var cond = (it.summary || '').split(',')[0];
      setText('tile-weather-ctx', (cond ? cond + ' · ' : '') + 'Maksimir ' + hhmm(new Date(it.at || m.sourceUpdatedAt || now)) + ' · DHMZ');
      if (temp != null) setText('ds-temp', hrNumber(temp, 1) + '°');
    }
    if ((m = mods.emsc) && m.items) {
      var recent = m.items.filter(function (q) { return q.at && now - new Date(q.at).getTime() <= 72 * 3600000; });
      var strongest = recent.reduce(function (a, q) { return q.data && typeof q.data.mag === 'number' && (a == null || q.data.mag > a) ? q.data.mag : a; }, null);
      setValue('tile-quakes-value', String(recent.length), 'u 72 h');
      setText('tile-quakes-ctx', (strongest != null ? 'najjači ' + hrNumber(strongest, 1) + ' · ' : '') + 'EMSC');
    }
    if ((m = mods['dhmz-cap']) && m.items) {
      var active = m.items.filter(function (w) { return w.severity && w.severity !== 'minor' && w.severity !== 'info'; });
      var band = $('#live-lane .tl[data-domain="safety"][data-variant="band"]');
      if (m.status === 'live' || m.status === 'stale') {
        if (active.length) {
          setText('tile-safety-title', 'upozorenje · ' + active[0].title);
          if (band) { band.setAttribute('data-level', 'urgent'); band.setAttribute('data-tone', 'urgent'); }
        } else {
          setText('tile-safety-title', 'mirno · Nema upozorenja DHMZ-a za Zagreb.');
          if (band) { band.setAttribute('data-level', 'calm'); band.setAttribute('data-tone', 'calm'); }
        }
        setText('tile-safety-ctx', 'DHMZ · EMSC · ' + hhmm(new Date(m.fetchedAt || m.sourceUpdatedAt || now)));
      }
    }
    setText('live-when', 'uživo, ' + hhmm(new Date(t.generatedAt || now)));
    setText('live-note', 'Iste pločice, isti izvori i ista stanja kao u aplikaciji. Vrijednosti su osvježene pri otvaranju dokumenta s otvorenih izvora; snimka u priloženoj datoteci nosi datum izrade.');
  }
  function refreshLive() {
    if (!window.fetch || location.protocol !== 'https:' || !/(^|\.)zagreb\.aningfilm\.hr$/.test(location.hostname)) return;
    fetch('/api/teaser', { headers: { accept: 'application/json' }, credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (t) { if (t) applyTeaser(t); })
      .catch(function () { /* the snapshot stays */ });
  }

  // --- Wiring -----------------------------------------------------------------
  function init() {
    applyTheme(readPref());
    bindTheme();
    tickClock(); setSun();
    setInterval(tickClock, 1000);
    tickCode();
    setInterval(tickCode, 1000);
    $$('[data-action="print"]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
    $$('[data-action="demo-session"]').forEach(function (b) { b.addEventListener('click', function () { startDemo(b); }); });
    bindScrollspy();
    refreshLive();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
