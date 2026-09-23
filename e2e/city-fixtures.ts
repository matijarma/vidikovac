import type {Page} from '@playwright/test';
import type {CatalogueManifest,CityLive,Place} from '../shared/city/types';
import {emptyCatalogue} from '../shared/city/types';
import type {ModuleSnapshot} from '../worker/feed/schema';
import {FIXTURE_NOW} from '../test/feed/fixture-contexts';
export const CITY_VENUE:Place={id:'culture-browser',category:'culture',name:'Gradsko dramsko kazalište Gavella',lon:15.972,lat:45.814,sourceId:'culture',sourceRecord:'browser',website:'https://www.gavella.hr/'};
export function cityEvents(snapshot:ModuleSnapshot,now=FIXTURE_NOW.getTime()):void{
  snapshot.items.unshift({id:'city-browser-event',module:'dogadanja',kind:'event',tier:'session',title:'Večer u Gavelli',at:new Date(now+3_600_000).toISOString(),dateBasis:'event',data:{source:'kulturpunkt',venueHint:'u Gavelli',precision:'time'},link:'https://www.gavella.hr/'});
}
type FixtureBike=Omit<CityLive['bikes'][number],'observedAt'>;
/** The one BAJS station every city spec has read since the city sources landed: four bikes, no free dock. */
export const CITY_BIKE:FixtureBike={id:'test-bike',name:'BAJS Trg',lon:15.978,lat:45.814,bikes:4,docks:0,capacity:4,installed:true,renting:true,returning:true};
/**
 * The framed wall's census (e2e/wall-map.spec.ts): CITY_BIKE and two more
 * stations inside the frame of 106_1, so every disc the wall draws is on the
 * screen once -- a station with no bike (the grey "0") and one that is not
 * renting (the grey disc without a number, whatever its count).
 */
export const WALL_BIKES:readonly FixtureBike[]=[
  CITY_BIKE,
  {id:'zero',name:'BAJS Petrinjska',lon:15.975,lat:45.811,bikes:0,docks:8,capacity:8,installed:true,renting:true,returning:true},
  {id:'closed',name:'BAJS Jurišićeva',lon:15.980,lat:45.815,bikes:3,docks:5,capacity:8,installed:true,renting:false,returning:false},
];
/** The city API at `now`: the catalogue, one venue, the live BAJS stations (`bikes`, CITY_BIKE alone unless a spec asks for more) and a departures board. */
export async function installCityFixture(page:Page,now=FIXTURE_NOW.getTime(),bikes:readonly FixtureBike[]=[CITY_BIKE]){
  const source={id:'culture',name:'Gradski registar',url:'https://data.zagreb.hr',licence:'Otvorena dozvola',status:'live' as const,count:1,fetchedAt:new Date(now).toISOString()};
  const hashes={culture:'a'.repeat(64),streets:'b'.repeat(64),heritage:'c'.repeat(64),settlements:'d'.repeat(64)};
  const manifest:CatalogueManifest={schema:1,version:'city-browser',generatedAt:new Date(now).toISOString(),sources:Object.entries(hashes).map(([id,hash])=>({...source,id,kind:id==='streets'?'streets':id==='settlements'?'settlements':'places',chunks:[{hash,bytes:500}]}))};
  const data={
    culture:{...emptyCatalogue(),places:[CITY_VENUE]},
    streets:{...emptyCatalogue(),streets:[{id:'street-browser',name:'Ilica',settlement:'Zagreb',settlementId:'1',description:'Opis imena iz izvornog registra.'}]},
    heritage:{...emptyCatalogue(),places:[{id:'heritage-browser',category:'heritage',name:'Povijesna zgrada',lon:15.976,lat:45.814,sourceId:'heritage',sourceRecord:'Z-test',description:'Izvorni opis kulturnog dobra.',polygons:[[[[15.975,45.813],[15.977,45.813],[15.977,45.815],[15.975,45.815],[15.975,45.813]]]]}]},
    settlements:{...emptyCatalogue(),settlements:[{id:'1',name:'Zagreb',polygons:[[[[15.7,45.7],[16.2,45.7],[16.2,46],[15.7,46],[15.7,45.7]]]]}]},
  };
  const live:CityLive={schema:1,generatedAt:new Date(now).toISOString(),sources:[{...source,id:'bajs'}],bikes:bikes.map(bike=>({...bike,observedAt:new Date(now).toISOString()})),air:[],consultations:[]};
  await page.route('**/api/city/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/manifest'))return route.fulfill({json:manifest});
    if(url.pathname.endsWith('/live'))return route.fulfill({json:live});
    const entry=Object.entries(hashes).find(([,hash])=>url.pathname.includes(hash));
    if(entry)return route.fulfill({json:{schema:1,source:{...source,id:entry[0]},data:data[entry[0] as keyof typeof data]}});
    if(url.pathname.endsWith('/departures'))return route.fulfill({json:{operator:'zet',stopId:url.searchParams.get('stop'),stopName:'Trg',status:'live',generatedAt:new Date(now).toISOString(),departures:[{operator:'zet',tripId:'t',routeId:'6',routeName:'6',headsign:'Sopot',at:new Date(now+600000).toISOString()}]}});
    return route.fulfill({status:404,json:{error:'not-found'}});
  });
}
