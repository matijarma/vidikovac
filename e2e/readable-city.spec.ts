import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {experienceSnapshots,installExperienceFixture,FIXTURE_DASHBOARD} from './experience-fixtures';
import {installCityFixture,cityEvents,CITY_VENUE} from './city-fixtures';
import {fulfillPublicMap} from '../scripts/review-maps.mjs';
import {APP_URL,provisionKiosk} from './helpers';

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

test('passive kiosk holds useful long subjects through multiple QR cycles, warnings and outages',async({page,request})=>{
  await page.setViewportSize({width:1366,height:768});
  const now=Date.now();
  const snapshots=await experienceSnapshots();
  cityEvents(snapshots.dogadanja,now);
  snapshots.dogadanja.items[0]!.title='Večer u Gavelli: '+Array(25).fill('razgovor o gradu i kulturnoj baštini').join(' ');
  snapshots['dhmz-cap'].items=[{
    id:'active-warning',module:'dhmz-cap',kind:'warning',tier:'open',title:'Jak vjetar',
    severity:'severe',at:new Date(now-60000).toISOString(),until:new Date(now+3600000).toISOString(),
  }];
  let outage=false;
  await installCityFixture(page,now);
  await page.route('**/api/teaser*',route=>route.fulfill({json:{modules:Object.values(snapshots).map(snapshot=>({
    ...snapshot,status:outage?'down':'live',fetchedAt:new Date(now).toISOString(),
    items:outage?[]:snapshot.items,
  }))}}));
  await page.route('**/maps/**',route=>fulfillPublicMap(route));
  const {kioskUrl}=await provisionKiosk(request,APP_URL);
  await page.clock.install({time:now});
  await page.goto(kioskUrl);
  await expect(page.getByTestId('pair-code')).toHaveAttribute('data-state','live');
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status','ready',{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  const seen=new Set<string>();
  const check=async()=>{
    expect(await page.evaluate(()=>{
      const qr=document.querySelector('[data-testid=kiosk-qr]')!.getBoundingClientRect();
      const highlight=document.querySelector('[data-testid=kiosk-highlight]')!;
      const box=highlight.getBoundingClientRect();
      const content=highlight.querySelector('.k-highlight-content')!;
      const footer=document.querySelector('[data-testid=safety-strip]')!.getBoundingClientRect();
      return {
        fits:highlight.scrollHeight<=highlight.clientHeight+1&&content.scrollHeight<=content.clientHeight+1,
        safe:box.bottom<=qr.top+1&&qr.bottom<=footer.top,
        qr:Math.min(qr.width,qr.height),
        scrolling:document.documentElement.scrollHeight>innerHeight+1,
      };
    })).toEqual({fits:true,safe:true,qr:240,scrolling:false});
    const current=await page.locator('.k-highlight-content').getAttribute('data-highlight');
    if(current)seen.add(current);
  };
  for(let cycle=0;cycle<7;cycle++){
    await check();
    await expect(page.getByTestId('safety-strip')).toContainText('Jak vjetar');
    await page.clock.fastForward(20_000);
  }
  expect([...seen].some(id=>id.startsWith('event:')),JSON.stringify([...seen])).toBe(true);
  expect([...seen].some(id=>id.startsWith('bajs-'))).toBe(true);
  await page.locator('[data-action=pause-highlights]').click();
  const held=await page.locator('.k-highlight-content').getAttribute('data-highlight');
  await page.clock.fastForward(40_000);
  await expect(page.locator('.k-highlight-content')).toHaveAttribute('data-highlight',held!);
  await page.locator('[data-action=pause-highlights]').click();
  outage=true;
  await page.clock.fastForward(60_000);
  await expect(page.getByTestId('safety-strip')).toContainText('nedostupni');
  await check();
  await page.screenshot({path:'test-results/readable-city/kiosk-outage.png'});
  await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
  for(const viewport of [{width:1080,height:1920},{width:3840,height:2160},{width:320,height:568}]){
    await page.setViewportSize(viewport);
    if(viewport.width===320){
      await expect(page.locator('.k-handheld-info')).toBeVisible();
      await expect.poll(()=>page.locator('.k-geography').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(241);
    }else{
      expect(await page.getByTestId('kiosk-qr').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(240);
    }
  }
});
