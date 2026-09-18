// Local rendered upgrade review. Public resources are GET-only, source data
// uses recorded parser samples and real bootstrap catalogue; no production grants.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root=process.cwd(),out=resolve(root,'review.local/city-review'),base='http://127.0.0.1:5178';
mkdirSync(out,{recursive:true});
const loader=await createServer({configFile:false,root,appType:'custom',logLevel:'silent',cacheDir:resolve(out,'ssr'),server:{middlewareMode:true,hmr:false,watch:null}});
const {experienceSnapshots,installExperienceFixture,FIXTURE_DASHBOARD,FIXTURE_STOP}=await loader.ssrLoadModule('/e2e/experience-fixtures.ts');
const {teaserSubset}=await loader.ssrLoadModule('/worker/feed/registry.ts');
const snapshots=await experienceSnapshots();
// Existing source contract, explicit venue evidence for the tested join.
snapshots.dogadanja.items.unshift({id:'review-gavella',module:'dogadanja',kind:'event',tier:'session',title:'Večer u Gavelli',at:'2026-09-11T18:00:00Z',dateBasis:'event',data:{source:'kulturpunkt',venueHint:'U Gavelli',precision:'time'},link:'https://www.gavella.hr/'});
const now=Date.parse(snapshots['zet-rt'].sourceUpdatedAt);
const manifest=JSON.parse(readFileSync('app/public/data/city/manifest.json','utf8'));
const live={schema:1,generatedAt:new Date(now).toISOString(),sources:[{id:'bajs',name:'BAJS',url:'https://bajs.zagreb.hr',licence:'CC0-1.0',status:'live',count:1,fetchedAt:new Date(now).toISOString()}],
  bikes:[{id:'review-bike',name:'Trg bana Jelačića',lon:15.978,lat:45.813,bikes:4,docks:3,capacity:7,installed:true,renting:true,returning:true,observedAt:new Date(now).toISOString()}],air:[],consultations:[]};
const b=await chromium.launch({headless:true}),records=[];
try{
  for(const scene of [
    {name:'kiosk-wide',width:1920,height:1080,kiosk:true},
    {name:'kiosk-compact',width:1366,height:768,kiosk:true},
    {name:'kiosk-portrait',width:1080,height:1920,kiosk:true},
    {name:'phone',width:390,height:844},
    {name:'small',width:320,height:568},
    {name:'desktop',width:1440,height:900},
    {name:'lightweight',width:390,height:844,light:true},
  ]){
    const context=await b.newContext({viewport:{width:scene.width,height:scene.height},locale:'hr-HR',timezoneId:'Europe/Zagreb',colorScheme:'light',reducedMotion:'reduce'});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await installExperienceFixture(page,snapshots);
    await page.route('**/api/city/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/manifest'))return route.fulfill({json:manifest});
      if(path.endsWith('/live'))return route.fulfill({json:live});
      if(path.includes('/chunks/')){const file=path.split('/').at(-1);return route.fulfill({contentType:'application/json',body:readFileSync(`app/public/data/city/chunks/${file}`)});}
      return route.fulfill({json:{operator:'zet',stopId:'106_1',stopName:FIXTURE_STOP.name,status:'down',departures:[],generatedAt:new Date(now).toISOString()}});
    });
    await page.route('**/maps/**',async route=>{const u=new URL(route.request().url());if(!u.pathname.startsWith('/maps/'))return route.continue();try{const r=await route.fetch({url:`https://zagreb.aningfilm.hr${u.pathname}${u.search}`,timeout:15000});await route.fulfill({response:r})}catch{await route.abort()}});
    await page.addInitScript(({stop,kiosk,light})=>{
      localStorage.setItem('vidikovac-theme','light');localStorage.setItem('vidikovac-locale','hr');localStorage.setItem('vidikovac-lagano',light?'1':'0');
      if(kiosk)localStorage.setItem('vidikovac-beacon',JSON.stringify({beaconId:'ABCDEFGH',secret:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',screen:{kind:'venue',expiresAt:null,stop}}));
    },{stop:FIXTURE_STOP,kiosk:scene.kiosk,light:scene.light});
    if(scene.kiosk){
      await page.route('**/api/teaser*',r=>r.fulfill({json:{generatedAt:new Date(now).toISOString(),modules:Object.values(snapshots).map(s=>teaserSubset(s,FIXTURE_STOP))}}));
      await page.routeWebSocket('**/ws/beacon/**',socket=>{socket.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.t==='auth'||m.t==='more')socket.send(JSON.stringify({t:'codes',serverNow:now,screen:{kind:'venue',expiresAt:null,stop:FIXTURE_STOP},batch:[{code:'ABCDEFGH',slotStart:now,slotEnd:now+30000}]}))});socket.send(JSON.stringify({t:'challenge',nonce:'local-review'}))});
    }
    await page.goto(base+(scene.kiosk?'/kiosk/':FIXTURE_DASHBOARD));
    await page.waitForTimeout(3000);
    async function capture(name){
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:resolve(out,name+'.png')});
      records.push({name,errors:[...new Set(errors)],...(await page.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,
        panels:[...document.querySelectorAll('.k-panel')].map(el=>({id:el.dataset.panel,rows:el.querySelectorAll('.k-fr').length,overflowY:el.scrollHeight-el.clientHeight,box:[el.clientWidth,el.clientHeight]})),
        qr:[...document.querySelectorAll('[data-testid=kiosk-qr]')].map(el=>[el.clientWidth,el.clientHeight]),text:document.body.innerText.slice(0,2500)})))});
      writeFileSync(resolve(out,'results.json'),JSON.stringify(records,null,2));console.log(name,errors.length);
    }
    await capture(scene.name);
    if(!scene.kiosk){
      await page.locator('.ki-tab[data-layer=u-pokretu]').first().click();await page.waitForTimeout(3000);await capture(scene.name+'-map');
      await page.getByTestId('transport-search').fill('Gavella');await page.waitForTimeout(1500);await capture(scene.name+'-search');
      const result=page.locator('[data-action=select-place]').filter({hasText:'Gavella'}).first();
      if(await result.count()){await result.click();await capture(scene.name+'-venue');}
    }else{
      await page.locator('[data-action=kiosk-explore]').click();await page.waitForTimeout(1000);await capture(scene.name+'-explore');
    }
    await context.close();
  }
}finally{await b.close();await loader.close();}
