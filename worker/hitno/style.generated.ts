// GENERATED FILE, do not edit. scripts/build-hitno-style.mjs writes it from the
// sRGB literals of app/src/ui/tokens.css; `npm run build` runs the generator
// first, and test/open/hitno-style.test.ts fails the moment this copy is
// behind. /hitno and /open/ paint the app palette without loading a stylesheet.

/** The palette, radii, targets and the system stack as custom properties, for a page that brings its own layout (the 429 page). */
export const PAGE_PALETTE = `:root{color-scheme:light dark;--canvas:#f1f4f7;--canvas-deep:#e5eaf0;--surface-1:#fbfcfe;--surface-2:#eaf0f6;--ink:#142334;--muted:#47586d;--accent:#0751bf;--accent-deep:#093e8a;--warning:#89521a;--danger:#b72d39;--success:#176b56;--stroke:rgba(20, 35, 52, 0.15);--stroke-strong:rgba(20, 35, 52, 0.48);--r-lg:1rem;--r-md:.75rem;--target:2.75rem;--target-primary:3rem;--font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--canvas:#111922;--canvas-deep:#0c131c;--surface-1:#192430;--surface-2:#23313f;--ink:#eef3fa;--muted:#b8c5d5;--accent:#84b5ff;--accent-deep:#b0cfff;--warning:#efbc76;--danger:#ff9aa5;--success:#79d5b4;--stroke:rgba(238, 243, 250, 0.16);--stroke-strong:rgba(238, 243, 250, 0.42)}}
`;

/** The one inline stylesheet of /hitno. */
export const HITNO_STYLE = `:root{color-scheme:light dark;--canvas:#f1f4f7;--canvas-deep:#e5eaf0;--surface-1:#fbfcfe;--surface-2:#eaf0f6;--ink:#142334;--muted:#47586d;--accent:#0751bf;--accent-deep:#093e8a;--warning:#89521a;--danger:#b72d39;--success:#176b56;--stroke:rgba(20, 35, 52, 0.15);--stroke-strong:rgba(20, 35, 52, 0.48);--r-lg:1rem;--r-md:.75rem;--target:2.75rem;--target-primary:3rem;--font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--canvas:#111922;--canvas-deep:#0c131c;--surface-1:#192430;--surface-2:#23313f;--ink:#eef3fa;--muted:#b8c5d5;--accent:#84b5ff;--accent-deep:#b0cfff;--warning:#efbc76;--danger:#ff9aa5;--success:#79d5b4;--stroke:rgba(238, 243, 250, 0.16);--stroke-strong:rgba(238, 243, 250, 0.42)}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--canvas);color:var(--ink);font:1rem/1.4 var(--font);-webkit-text-size-adjust:100%}
a{color:var(--accent);text-underline-offset:.15em}
a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:.25rem}
.skip{position:absolute;left:-999px;top:1rem;z-index:3;display:inline-flex;align-items:center;min-height:var(--target);padding:0 1rem;border-radius:var(--r-md);background:var(--surface-1);color:var(--ink);font-weight:700}
.skip:focus{left:1rem}
.brand{display:inline-flex;align-items:center;min-height:var(--target);color:var(--ink);font-size:1.375rem;font-weight:700;letter-spacing:-.03em;text-decoration:none}
.brand .mark{color:var(--accent)}
h1{margin:.25rem 0 .5rem;font-size:1.75rem;line-height:1.2;font-weight:700;letter-spacing:-.02em}
.lede{max-width:68ch;margin:0 0 .5rem;font-size:1rem;line-height:1.5}
.stamp{margin:0;color:var(--muted);font-size:.8125rem}
main{display:block}
footer.page{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--stroke);color:var(--muted);font-size:.8125rem;line-height:1.5}
footer.page p{max-width:68ch;margin:0 0 .5rem}
.foot-links{display:flex;flex-wrap:wrap;gap:0 .5rem;list-style:none;margin:0;padding:0}
.foot-links a{display:inline-flex;align-items:center;justify-content:center;min-height:var(--target);min-width:var(--target);padding:0 .25rem;border-radius:.25rem;font-weight:600}

html{scroll-padding-top:3.5rem}
.wrap{max-width:64rem;margin:0 auto;padding:1rem 1rem 3rem}
header{padding:0 0 1rem}
nav.toc{position:sticky;top:0;z-index:2;margin:0 -1rem;padding:0 1rem;background:var(--canvas);border-bottom:1px solid var(--stroke)}
nav.toc ul{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:.25rem;list-style:none;margin:0;padding:0;scrollbar-width:none;-webkit-overflow-scrolling:touch}
nav.toc ul::-webkit-scrollbar{display:none}
nav.toc li{flex:none}
nav.toc a{display:inline-flex;align-items:center;height:3rem;padding:0 .75rem;border-bottom:2px solid transparent;color:var(--ink);font-size:.875rem;font-weight:700;white-space:nowrap;text-decoration:none}
nav.toc a:focus-visible{outline-offset:-3px}
section{margin:0;padding:1.5rem 0;border-top:1px solid var(--stroke)}
#brojevi{border-top:0;padding-top:.5rem}
h2{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;margin:0 0 .75rem;font-size:1.125rem;line-height:1.2;font-weight:700}
h3{margin:0;font-size:1rem;line-height:1.4;font-weight:600}
p{max-width:68ch}
.check{padding:.1rem .55rem;border:1px solid currentColor;border-radius:999px;color:var(--warning);font-size:.8125rem;font-weight:700;line-height:1.4}
.status{display:flex;align-items:baseline;gap:.4rem;margin:0 0 .75rem;color:var(--muted);font-size:.8125rem}
.status .dot{flex:none}
.status.live .dot{color:var(--success)}.status.stale .dot{color:var(--warning)}.status.down .dot{color:var(--danger)}
ul.items{list-style:none;margin:0;padding:0}
ul.items>li{padding:.75rem 0;border-top:1px solid var(--stroke)}
ul.items>li:first-child{border-top:0}
ul.items p{margin:.35rem 0 0}
.title{font-weight:600}
.meta{margin-top:.15rem;color:var(--muted);font-size:.8125rem}
.sev{display:inline-block;margin-right:.4rem;padding:.1rem .55rem;border:1px solid currentColor;border-radius:999px;font-size:.8125rem;font-weight:700;line-height:1.4;vertical-align:.1em}
.sev-info{color:var(--muted)}.sev-minor,.sev-moderate{color:var(--warning)}.sev-severe,.sev-extreme{color:var(--danger)}
.empty{margin:.25rem 0;color:var(--muted)}
.src{margin-top:.75rem;padding-top:.5rem;border-top:1px solid var(--stroke);color:var(--muted);font-size:.75rem;line-height:1.5}
.src p{margin:0;max-width:none}
.meta a,.src a,.stamp a,.empty a{display:inline-block;min-width:2.75rem;padding:.75rem .25rem;margin:0 -.25rem;line-height:1.25rem;text-align:center}
.numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(9rem,45%),1fr));gap:.75rem;list-style:none;margin:0;padding:0}
.numbers li{display:grid}
.numbers li:first-child{grid-column:span 2}
.numbers a{display:grid;align-content:space-between;gap:.5rem;min-height:5.5rem;padding:.75rem;border-radius:var(--r-md);background:var(--surface-2);color:var(--ink);text-decoration:none}
.numbers b{font-size:2rem;line-height:1;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.numbers span{font-size:.875rem;line-height:1.4;color:var(--muted)}
.numbers li:first-child a{background:var(--ink);color:var(--canvas)}
.numbers li:first-child b{font-size:2.5rem}
.numbers li:first-child span{color:inherit}
.pharmacies{list-style:none;margin:0;padding:0}
.pharmacies li{padding:.75rem 0;border-top:1px solid var(--stroke)}
.pharmacies li:first-child{border-top:0}
.pharmacies p{margin:.15rem 0 0}
.pharmacy-call{display:inline-flex;align-items:center;min-height:var(--target-primary);margin-top:.5rem;padding:0 1rem;border:1px solid var(--stroke-strong);border-radius:var(--r-md);font-weight:700;text-decoration:none}
details{border-top:1px solid var(--stroke)}
summary{display:flex;align-items:center;gap:.5rem;min-height:var(--target);padding:.5rem 0;cursor:pointer;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"";flex:none;width:.5rem;height:.5rem;margin:0 .35rem 0 .25rem;border:solid currentColor;border-width:0 2px 2px 0;transform:translateY(-.15rem) rotate(45deg);transition:transform 140ms ease-out}
details[open]>summary::before{transform:translateY(.15rem) rotate(225deg)}
.count{color:var(--muted);font-weight:400}
.districts{margin-top:.5rem}
.district>ul.items{padding:0 0 .5rem 1.25rem}
.district>ul.items>li:first-child{border-top:1px solid var(--stroke)}
@media (hover:hover){.numbers a:hover{background:var(--canvas-deep)}.numbers li:first-child a:hover{background:var(--ink);opacity:.92}.pharmacy-call:hover,.foot-links a:hover{background:var(--surface-2)}nav.toc a:hover{border-bottom-color:var(--accent)}}
@media (hover:none){.numbers a:active{background:var(--canvas-deep)}.pharmacy-call:active,nav.toc a:active,summary:active,.foot-links a:active{background:var(--surface-2)}}
@media (prefers-reduced-motion:reduce){summary::before{transition:none}}
@media (min-width:40rem){.wrap{padding:1.5rem 2rem 4rem}nav.toc{margin:0;padding:0}}
@media (min-width:60rem){.wrap{padding:2rem 2rem 4rem}header{padding-bottom:1.5rem}h2{font-size:1.375rem}.safety-columns{display:grid;grid-template-columns:1.2fr 1fr;gap:0 3rem;align-items:start}}
@media (min-width:90rem){.wrap{padding:2rem 3rem 4rem}}
@media print{html,body{background:#fff;color:#000;font-size:11pt}section{border-color:#999;break-inside:avoid}main,.safety-columns{display:block}nav.toc,.skip,.foot-links{display:none}a{color:#000}.numbers a,.numbers li:first-child a{background:transparent;color:#000;border:1px solid #999}a.ext[href]::after{content:" (" attr(href) ")";font-size:.8em;color:#555}}
`;

/** The one inline stylesheet of /open/. */
export const OPEN_STYLE = `:root{color-scheme:light dark;--canvas:#f1f4f7;--canvas-deep:#e5eaf0;--surface-1:#fbfcfe;--surface-2:#eaf0f6;--ink:#142334;--muted:#47586d;--accent:#0751bf;--accent-deep:#093e8a;--warning:#89521a;--danger:#b72d39;--success:#176b56;--stroke:rgba(20, 35, 52, 0.15);--stroke-strong:rgba(20, 35, 52, 0.48);--r-lg:1rem;--r-md:.75rem;--target:2.75rem;--target-primary:3rem;--font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--canvas:#111922;--canvas-deep:#0c131c;--surface-1:#192430;--surface-2:#23313f;--ink:#eef3fa;--muted:#b8c5d5;--accent:#84b5ff;--accent-deep:#b0cfff;--warning:#efbc76;--danger:#ff9aa5;--success:#79d5b4;--stroke:rgba(238, 243, 250, 0.16);--stroke-strong:rgba(238, 243, 250, 0.42)}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--canvas);color:var(--ink);font:1rem/1.4 var(--font);-webkit-text-size-adjust:100%}
a{color:var(--accent);text-underline-offset:.15em}
a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:.25rem}
.skip{position:absolute;left:-999px;top:1rem;z-index:3;display:inline-flex;align-items:center;min-height:var(--target);padding:0 1rem;border-radius:var(--r-md);background:var(--surface-1);color:var(--ink);font-weight:700}
.skip:focus{left:1rem}
.brand{display:inline-flex;align-items:center;min-height:var(--target);color:var(--ink);font-size:1.375rem;font-weight:700;letter-spacing:-.03em;text-decoration:none}
.brand .mark{color:var(--accent)}
h1{margin:.25rem 0 .5rem;font-size:1.75rem;line-height:1.2;font-weight:700;letter-spacing:-.02em}
.lede{max-width:68ch;margin:0 0 .5rem;font-size:1rem;line-height:1.5}
.stamp{margin:0;color:var(--muted);font-size:.8125rem}
main{display:block}
footer.page{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--stroke);color:var(--muted);font-size:.8125rem;line-height:1.5}
footer.page p{max-width:68ch;margin:0 0 .5rem}
.foot-links{display:flex;flex-wrap:wrap;gap:0 .5rem;list-style:none;margin:0;padding:0}
.foot-links a{display:inline-flex;align-items:center;justify-content:center;min-height:var(--target);min-width:var(--target);padding:0 .25rem;border-radius:.25rem;font-weight:600}

.wrap{max-width:46rem;margin:0 auto;padding:1.5rem 1.5rem 4rem}
header{padding:0 0 1rem}
.lede{margin:0}
article,.offer{margin:0;padding:1.5rem 0;border-top:1px solid var(--stroke)}
h2{margin:0 0 .25rem;font-size:1.125rem;line-height:1.2;font-weight:700}
p{max-width:68ch}
.meta{margin:0 0 .5rem;color:var(--muted);font-size:.8125rem}
article p,.offer p{margin:.5rem 0 0;line-height:1.5}
ul.dl{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:.75rem 0 0;padding:0}
ul.dl a{display:inline-flex;align-items:center;min-height:var(--target);padding:0 1rem;border:1px solid var(--stroke-strong);border-radius:var(--r-md);font-weight:700;text-decoration:none}
.src{margin:.75rem 0 0;color:var(--muted);font-size:.75rem;line-height:1.5;max-width:none}
.src a,.lede a,.offer a,footer.page p a{display:inline-block;min-width:2.75rem;padding:.75rem .25rem;margin:0 -.25rem;line-height:1.25rem;text-align:center}
@media (hover:hover){ul.dl a:hover,.foot-links a:hover{background:var(--surface-2)}}
@media (hover:none){ul.dl a:active,.foot-links a:active{background:var(--surface-2)}}
@media (max-width:30rem){.wrap{padding:1rem 1rem 3rem}ul.dl li{flex:1 1 8rem}ul.dl a{width:100%;justify-content:center}}
@media (min-width:60rem){.wrap{padding:3rem 2rem 5rem}header{padding-bottom:1.5rem}.lede{font-size:1.125rem}article,.offer{padding:2rem 0}}
`;
