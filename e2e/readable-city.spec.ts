import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {experienceSnapshots,installExperienceFixture,installWallFixture,FIXTURE_DASHBOARD,FIXTURE_STOP} from './experience-fixtures';
import {installCityFixture,cityEvents,CITY_VENUE} from './city-fixtures';
import {fulfillPublicMap} from '../scripts/review-maps.mjs';
import {APP_URL,E2E_STOP_ID,provisionKiosk} from './helpers';
import {teaserSubset} from '../worker/feed/registry';
import type {ModuleId,ModuleSnapshot} from '../worker/feed/schema';
import {FIXTURE_NOW} from '../test/feed/fixture-contexts';

test('320px search keeps a complete stop result above navigation and the keyboard',async({page})=>{
  await page.setViewportSize({width:320,height:568});
  const snapshots=await experienceSnapshots();cityEvents(snapshots.dogadanja);
  await installExperienceFixture(page,snapshots);await installCityFixture(page);
  await page.route('**/maps/**',route=>fulfillPublicMap(route));
  await page.goto(FIXTURE_DASHBOARD);
  await page.locator('.ki-tab[data-layer=u-pokretu]').click();
  const search=page.getByTestId('transport-search');
  await search.fill('Trg bana');
  const first=page.getByRole('option').first();
  await expect(first).toHaveAttribute('data-action','select-stop');
  await expect(page.getByTestId('transport-workspace')).toHaveAttribute('data-sheet','open');
  const visible=()=>page.evaluate(()=>{
    const row=document.querySelector('[role=option]')!.getBoundingClientRect();
    const body=document.querySelector('.t-sheet-body')!.getBoundingClientRect();
    const nav=document.querySelector('.ki-tabs')!.getBoundingClientRect();
    const viewport=visualViewport!;
    return row.top>=body.top&&row.bottom<=Math.min(body.bottom,nav.top,viewport.offsetTop+viewport.height)+1;
  });
  await expect.poll(visible).toBe(true);
  await page.screenshot({path:'test-results/readable-city/search-320.png'});
  // Chromium automation has no physical keyboard. Exercise VisualViewport
  // occlusion directly, without shrinking the layout viewport or map canvas.
  await page.evaluate(()=>{
    Object.defineProperty(visualViewport,'height',{value:290,configurable:true});
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(visible).toBe(true);
  await page.screenshot({path:'test-results/readable-city/search-keyboard.png'});
  await search.press('ArrowDown');await search.press('Enter');
  await expect(page.getByTestId('stop-title')).toContainText('Trg bana');
  await page.locator('[data-action=clear-selection]').click();
  await expect(search).toHaveValue('Trg bana');
  await search.fill('zzzz-unfindable');
  await expect(page.getByTestId('transport-detail')).toContainText('Nema rezultata');
  await page.reload();
  await expect(search).toHaveValue('zzzz-unfindable');
  await expect(page.getByTestId('transport-workspace')).toHaveAttribute('data-sheet','open');
});

test('save, leave, retrieve, reload and keyboard search remain private',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const snapshots=await experienceSnapshots();cityEvents(snapshots.dogadanja);
  const session=await installExperienceFixture(page,snapshots);await installCityFixture(page);
  await page.route('**/maps/**',route=>fulfillPublicMap(route));
  await page.goto(FIXTURE_DASHBOARD);
  await page.locator('.ki-tab[data-layer=u-pokretu]').click();
  await page.getByTestId('transport-search').fill('Gavella');
  await page.getByTestId('transport-search').press('ArrowDown');
  await page.getByTestId('transport-search').press('Enter');
  await page.locator('[data-action=city-save]').click();
  await page.getByTestId('tab-more').click();
  await expect(page.getByTestId('saved-section')).toContainText('Gavella');
  await page.getByTestId('saved-section').getByRole('link').click();
  await expect(page.getByTestId('city-detail')).toHaveAttribute('data-place-id',CITY_VENUE.id);
  await page.reload();
  await expect(page.getByTestId('city-detail')).toContainText('Gavella');
  expect(session.events.filter(e=>e.t==='present')).toEqual([]);
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  expect(audit.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>v.id)).toEqual([]);
});

for(const dpr of [1,2,3])test(`handheld map keeps CSS symbol scale at DPR ${dpr}`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:dpr});
  try {
    const page=await context.newPage();
    const snapshots=await experienceSnapshots();cityEvents(snapshots.dogadanja);
    await installExperienceFixture(page,snapshots);await installCityFixture(page);
    await page.route('**/maps/**',route=>fulfillPublicMap(route));
    await page.goto(FIXTURE_DASHBOARD);
    await page.locator('.ki-tab[data-layer=u-pokretu]').click();
    await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map-status','ready',{timeout:30000});
    await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-presentation-profile','handheld');
    const dimensions=await page.locator('.maplibregl-canvas').evaluate(canvas=>({
      css:canvas.getBoundingClientRect().width,
      bitmap:(canvas as HTMLCanvasElement).width,
      dpr:devicePixelRatio,
    }));
    expect(dimensions.css).toBe(390);
    expect(dimensions.dpr).toBe(dpr);
    expect(dimensions.bitmap).toBeGreaterThanOrEqual(dimensions.css);
    await page.screenshot({path:`test-results/readable-city/map-dpr-${dpr}.png`});
  } finally {await context.close();}
});

// --- The wall of 22 September (brief §11, §12; WP1) ---------------------------
// One reading of the wall's aside and header: the "U blizini" list and the QR
// card each fit their box; rows are whole (sliced by the row budget, never
// hidden or cut by the list's edge) and 64–92 px tall at the design size; at
// most three departures; the list sits above the card and the card above the
// footer; the QR code itself is at least 240 px; the header sentence is one
// line of at most 80 characters, never cut, with a validity it has not passed.
async function wallState(page:Page){
  return page.evaluate(()=>{
    const q=<T extends Element=HTMLElement>(selector:string)=>document.querySelector<T>(selector);
    const nearby=q('[data-testid=nearby]')!,list=q('[data-testid=nearby-rows]')!,card=q('.k-panel--card')!;
    const footer=q('[data-testid=safety-strip]')!.getBoundingClientRect();
    const sentence=q('[data-testid=kiosk-sentence]'),text=q('[data-testid=kiosk-sentence-text]');
    const qr=q('[data-testid=kiosk-qr] svg')?.getBoundingClientRect();
    const zoom=Number.parseFloat(getComputedStyle(nearby).getPropertyValue('--k-zoom'))||1;
    const listBox=list.getBoundingClientRect(),nearbyBox=nearby.getBoundingClientRect(),cardBox=card.getBoundingClientRect();
    const rows=[...list.querySelectorAll<HTMLElement>('.nearby-row')];
    const words=(text?.textContent??'').trim();
    return {
      overflow:{nearby:nearby.scrollHeight-nearby.clientHeight,rows:list.scrollHeight-list.clientHeight,card:card.scrollHeight-card.clientHeight,page:document.documentElement.scrollHeight-innerHeight},
      rows:rows.length,
      hiddenRows:rows.filter(row=>row.hidden).length,
      cutRows:rows.filter(row=>row.getBoundingClientRect().bottom>listBox.bottom+1).length,
      // A row's words stay inside its own row: a squeezed track spills them over the next row, unseen by the list's edge.
      spilledRows:rows.filter(row=>row.scrollHeight>row.clientHeight+1).length,
      rowPx:rows.map(row=>Math.round(Number.parseFloat(getComputedStyle(row).minHeight)/zoom)),
      departures:rows.filter(row=>row.dataset.kind==='departure').length,
      order:{listOverCard:nearbyBox.bottom-cardBox.top,cardOverFooter:cardBox.bottom-footer.top},
      qr:qr?Math.floor(Math.min(qr.width,qr.height)):0,
      sentence:words,
      sentenceChars:[...words].length,
      sentenceOverflow:text?text.scrollWidth-text.clientWidth:0,
      validUntil:sentence?.getAttribute('data-valid-until')??null,
      now:Date.now(),
    };
  });
}
function expectWall(state:Awaited<ReturnType<typeof wallState>>,label:string){
  const why=`${label}: ${JSON.stringify(state)}`;
  for(const overflow of Object.values(state.overflow))expect(overflow,why).toBeLessThanOrEqual(1);
  expect(state.rows,why).toBeGreaterThan(0);
  expect(state.hiddenRows,why).toBe(0);
  expect(state.cutRows,why).toBe(0);
  expect(state.spilledRows,why).toBe(0);
  for(const px of state.rowPx){expect(px,why).toBeGreaterThanOrEqual(64);expect(px,why).toBeLessThanOrEqual(92);}
  expect(state.departures,why).toBeLessThanOrEqual(3);
  expect(state.order.listOverCard,why).toBeLessThanOrEqual(1);
  expect(state.order.cardOverFooter,why).toBeLessThanOrEqual(1);
  expect(state.qr,why).toBeGreaterThanOrEqual(240);
  expect(state.sentence,why).not.toBe('');
  expect(state.sentenceChars,why).toBeLessThanOrEqual(80);
  expect(state.sentence,why).not.toMatch(/…|\.\.\./);
  expect(state.sentenceOverflow,why).toBeLessThanOrEqual(1);
  expect(state.validUntil,why).not.toBeNull();
  const until=/^\d+$/.test(state.validUntil??'')?Number(state.validUntil):Date.parse(state.validUntil??'');
  if(Number.isFinite(until))expect(until,why).toBeGreaterThanOrEqual(state.now-1500);
}
/** Every departure on the list is a grey timetable time: no row claims a tracked vehicle. */
async function expectTimetableOnly(page:Page){
  await expect(page.locator('[data-testid=nearby] .nearby-row[data-live]')).toHaveCount(0);
  for(const when of await page.locator('[data-testid=nearby] .nearby-row[data-kind=departure] .nearby-when').allInnerTexts())expect(when.trim()).toMatch(/^\d{2}:\d{2}$/);
}

test('passive kiosk keeps whole rows, one short sentence and a scannable QR through QR cycles, a warning and an outage',async({page,request})=>{
  await page.setViewportSize({width:1366,height:768});
  const now=Date.now();
  // How far page.clock has been moved past the real clock: the departures board reads the page's time.
  let ahead=0;
  const snapshots=await experienceSnapshots();
  cityEvents(snapshots.dogadanja,now);
  snapshots.dogadanja.items[0]!.title='Večer u Gavelli: '+Array(25).fill('razgovor o gradu i kulturnoj baštini').join(' ');
  snapshots['dhmz-cap'].items=[{
    id:'active-warning',module:'dhmz-cap',kind:'warning',tier:'open',title:'Jak vjetar',
    severity:'severe',at:new Date(now-60000).toISOString(),until:new Date(now+3600000).toISOString(),
  }];
  let outage=false;
  await installCityFixture(page,now);
  await installWallFixture(page,{now:()=>Date.now()+ahead});
  await page.route('**/api/teaser*',route=>route.fulfill({json:{modules:Object.values(snapshots).map(snapshot=>({
    ...snapshot,status:outage?'down':'live',fetchedAt:new Date(now).toISOString(),
    items:outage?[]:snapshot.items,
  }))}}));
  await page.route('**/maps/**',route=>fulfillPublicMap(route));
  const {kioskUrl}=await provisionKiosk(request,APP_URL);
  await page.clock.install({time:now});
  await page.goto(kioskUrl);
  await expect(page.getByTestId('kiosk-code')).toHaveAttribute('data-state','live');
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status','ready',{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  const fastForward=async(ms:number)=>{await page.clock.fastForward(ms);ahead+=ms;};
  const texts:string[]=[];
  const check=async(label:string)=>{
    await expect(page.getByTestId('kiosk-sentence')).toBeVisible();
    await expect(page.getByTestId('kiosk-sentence-text')).not.toBeEmpty();
    const state=await wallState(page);
    expectWall(state,label);
    texts.push(state.sentence);
  };
  // Seven turns of the default 20 s rhythm: the sentence changes, the rows stay whole.
  for(let cycle=0;cycle<7;cycle++){
    await check(`cycle ${cycle}`);
    await expect(page.getByTestId('safety-strip')).toContainText('Jak vjetar');
    await fastForward(20_000);
  }
  await check('cycle 7');
  // A sentence may hold while nothing new is eligible; it never comes back once replaced.
  const turns=texts.filter((text,i)=>i===0||text!==texts[i-1]);
  expect(new Set(turns).size,JSON.stringify(texts)).toBeGreaterThanOrEqual(3);
  expect(turns.length,`no verbatim repeat: ${JSON.stringify(texts)}`).toBe(new Set(turns).size);
  // ZET and every other source down (brief §4.8): the map stays a map without vehicles and says so
  // once, quietly, every departure is a timetable time, and nothing in the header says "nedostupno".
  outage=true;
  await fastForward(60_000);
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-feed','down');
  await expect(page.getByTestId('map-note')).toBeVisible();
  await expect(page.locator('[data-testid=map-note]:visible')).toHaveCount(1);
  await expect.poll(()=>page.getByTestId('kiosk-map').getAttribute('data-pills'),{timeout:10_000}).toBeFalsy();
  await expectTimetableOnly(page);
  await expect(page.locator('.k-head')).not.toContainText(/nedostupn/i);
  await expect(page.getByTestId('kiosk-alert')).toBeHidden();
  await expect(page.getByTestId('safety-strip')).toContainText('nedostupni');
  await check('outage');
  await page.screenshot({path:'test-results/readable-city/kiosk-outage.png'});
  await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
  for(const viewport of [{width:1080,height:1920},{width:3840,height:2160},{width:320,height:568}]){
    await page.setViewportSize(viewport);
    if(viewport.width===320){
      await expect(page.locator('.k-handheld-info')).toBeVisible();
      await expect.poll(()=>page.locator('.k-geography').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(241);
    }else{
      await expect.poll(()=>page.locator('[data-testid=kiosk-qr] svg').evaluate(el=>Math.min(el.getBoundingClientRect().width,el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(240);
    }
  }
});

// 21:30 on Monday 21 September 2026 in Zagreb (CEST, UTC+2), the research's
// late-evening slot (brief §6.2), well after that day's sunset at 18:57.
const NIGHT_2130=Date.UTC(2026,8,21,19,30);

/** The recorded snapshots with every time moved by one amount, so the fixture's own moment lands on `now`. */
function shiftedTo(snapshots:Record<ModuleId,ModuleSnapshot>,now:number){
  const delta=now-FIXTURE_NOW.getTime();
  const shift=(value:string|undefined)=>value?new Date(Date.parse(value)+delta).toISOString():undefined;
  for(const snapshot of Object.values(snapshots)){
    snapshot.fetchedAt=shift(snapshot.fetchedAt)!;
    snapshot.sourceUpdatedAt=shift(snapshot.sourceUpdatedAt);
    snapshot.validUntil=shift(snapshot.validUntil);
    snapshot.items=snapshot.items.map(item=>({...item,at:shift(item.at),until:shift(item.until)}));
  }
  return snapshots;
}

// The night-palette artefact of the visual review (WP1 A10): the whole wall at
// 1920×1080 in the dark face, forced by ?tema=tamna, with the page's clock at
// 21:30, and the rendered contrast of the elements WP1 adds (the list, the
// header sentence, the footer's cross) checked on that face.
test('the wall at night: the dark palette at 21:30 under ?tema=tamna, 1920×1080',async({page,request})=>{
  await page.setViewportSize({width:1920,height:1080});
  const snapshots=shiftedTo(await experienceSnapshots(),NIGHT_2130);
  cityEvents(snapshots.dogadanja,NIGHT_2130);
  let clockAt=Date.now();
  await installCityFixture(page,NIGHT_2130);
  await installWallFixture(page,{now:()=>NIGHT_2130+Date.now()-clockAt});
  await page.route('**/api/teaser*',route=>route.fulfill({json:{generatedAt:new Date(NIGHT_2130).toISOString(),modules:Object.values(snapshots).map(snapshot=>teaserSubset(snapshot,FIXTURE_STOP))}}));
  await page.route('**/maps/**',route=>fulfillPublicMap(route));
  const {kioskUrl}=await provisionKiosk(request,APP_URL,{stopId:E2E_STOP_ID});
  const url=new URL(kioskUrl);
  url.search='?tema=tamna';
  await page.clock.install({time:NIGHT_2130});
  clockAt=Date.now();
  await page.goto(url.toString());
  await expect(page.locator('html')).toHaveAttribute('data-theme-resolved','dark');
  await expect(page.getByTestId('kiosk-code')).toHaveAttribute('data-state','live');
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status','ready',{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByTestId('kiosk-sentence-text')).not.toBeEmpty();
  await expect.poll(()=>page.locator('[data-testid=nearby] .nearby-row[data-kind=departure]').count(),{timeout:30000}).toBeGreaterThanOrEqual(1);
  expectWall(await wallState(page),'night 1920');
  await expectTimetableOnly(page);
  await page.screenshot({path:'test-results/readable-city/kiosk-night-2130.png'});
  // No fade or crossfade may be caught half-way by the contrast reading.
  await page.emulateMedia({reducedMotion:'reduce'});
  const contrast=await new AxeBuilder({page}).include('[data-testid=nearby]').include('[data-testid=kiosk-sentence]').include('[data-testid=strip-pharmacy]').withRules(['color-contrast']).analyze();
  expect(contrast.violations.flatMap(v=>v.nodes.map(n=>`${n.target.join(' ')}: ${(n.failureSummary??'').split('\n')[0]}`))).toEqual([]);
});
