import { describe,it,expect } from 'vitest';
import { parseAir,parseBikes,parseConsultations } from '../../worker/city/live';
import { normalizeReference } from '../../worker/city/normalize';
import { REFERENCE_SOURCES } from '../../worker/city/sources';
import { matchStreet } from '../../shared/city/geo';
import { activeVenues,eventInWindow,locatedEvents,resolveVenues,TONIGHT_FROM_HOUR } from '../../shared/city/events';
import { departuresFrom,scheduleInstant } from '../../worker/city/schedules';
import { parseSelection } from '../../worker/public-selection';
import { emptyCity,type Place } from '../../shared/city/types';
import { discover,dynamicPlaces } from '../../app/src/city/discovery';
import type { FeedItem } from '../../worker/feed/schema';
import {departuresMarkup,referenceDate} from '../../app/src/city/markup';
import {createDefaultI18n} from '../../app/src/i18n/create-default-i18n';
import type {DepartureBoard} from '../../shared/city/types';
import {bikeAvailability} from '../../shared/city/bikes';
const now=Date.parse('2026-09-18T12:00:00Z');
const place:Place={id:'culture-1',name:'Gavella',category:'culture',lon:15.97,lat:45.81,sourceId:'culture',sourceRecord:'1'};
const event:FeedItem={id:'e1',module:'dogadanja',tier:'session',kind:'event',title:'Predstava',dateBasis:'event',at:'2026-09-18T18:00:00Z',data:{source:'kulturpunkt',venueHint:'U Gavelli predstava',precision:'time'}};
describe('city source truth',()=>{
  it('distinguishes rent/return counts, disabled stations and stale inventory',()=>{
    const bike={...place,sourceId:'bajs',facts:{fresh:true,operational:true,returning:true,bikes:4,docks:0}};
    expect(bikeAvailability(bike,'rent')).toBe('4');
    expect(bikeAvailability(bike,'return')).toBe('0');
    expect(bikeAvailability({...bike,facts:{...bike.facts,operational:false}},'rent')).toBe('—');
    expect(bikeAvailability({...bike,facts:{...bike.facts,fresh:false}},'return')).toBe('?');
  });
  it('formats the original HTTP modification date without presenting a cut-off header',()=>{
    expect(referenceDate('Tue, 24 Jun 2025 16:11:04 GMT')).toBe('2025-06-24');
    expect(referenceDate('2026-09-10T11:22:12.000Z')).toBe('2026-09-10');
    expect(referenceDate('unavailable')).toBe('');
  });
  it('keeps zero and missing bike counts distinct and joins station IDs',()=>{
    const info={data:{stations:[{station_id:'a',name:'Trg',lat:45.81,lon:15.97},{station_id:'b',name:'Park',lat:45.8,lon:15.9}]}};
    const rows=parseBikes(info,{data:{stations:[{station_id:'a',num_bikes_available:0,num_docks_available:4,is_installed:true,is_renting:true,is_returning:false,last_reported:now/1000}]}});
    expect(rows[0]).toMatchObject({bikes:0,docks:4,returning:false});expect(rows[1].bikes).toBeNull();
  });
  it('air coordinates are swapped into lon/lat and null is not good',()=>{
    expect(parseAir([{id:155,kod:'RH0101',naziv:'Zagreb',x:45.8,y:15.9,indeks:null,vrijeme:null}])[0]).toMatchObject({lon:15.9,lat:45.8,index:null,observedAt:undefined});
  });
  it('consultation needs open status and active dates',()=>{
    const c={id:1,statusSavjetovanja:'Otvoren',pocetakSavjetovanja:'2026-09-01',zavrsetakSavjetovanja:'2026-09-30'};
    expect(parseConsultations([c,{...c,id:2,statusSavjetovanja:'Zatvoren'}],new Date(now).toISOString())).toHaveLength(1);
  });
  it('fountain active flag is not working status; internal fields are stripped',()=>{
    const source=REFERENCE_SOURCES.find(s=>s.id==='water')!;
    const body=JSON.stringify({type:'FeatureCollection',features:[{id:1,geometry:{type:'Point',coordinates:[15.97,45.81]},properties:{objectid:1,lokacija:'Trg',aktivan_da_ne:'DA',status_odrz:'nije u funkciji',created_user:'staff',broj_vodomjera:'private'}}]});
    const p=normalizeReference(source,body,new Date(now).toISOString()).data.places[0];
    expect(p.facts).toEqual({maintenance:'nije u funkciji'});expect(JSON.stringify(p)).not.toContain('private');
  });
  it('rejects incomplete geographic pages',()=>{
    expect(()=>normalizeReference(REFERENCE_SOURCES[0],JSON.stringify({type:'FeatureCollection',features:[],exceededTransferLimit:true}),new Date(now).toISOString())).toThrow();
  });
});
describe('place and time',()=>{
  it('uses verified aliases without inventing coordinates',()=>{
    expect(resolveVenues(event,[place])).toEqual([place.id]);
    expect(resolveVenues({...event,data:{...event.data,venueHint:'U nepoznatom klubu'}},[place])).toEqual([]);
    expect(resolveVenues({...event,data:{...event.data,city:'Split'}},[place])).toEqual([]);
    expect(resolveVenues({...event,data:{source:'kulturpunkt',venueTags:'gavella'}},[place])).toEqual([]);
  });
  it('deduplicates exact venue/start/title announcements, never independent performances',()=>{
    const events=locatedEvents([event,{...event,id:'e2'},{...event,id:'e3',at:'2026-09-19T18:00:00Z'}],[place],now);
    expect(events).toHaveLength(2);expect(activeVenues(events,[place])[0].count).toBe(2);
  });
  it('ongoing exhibitions remain one known program, expired events leave',()=>{
    const rows=locatedEvents([{...event,at:'2026-09-01T12:00:00Z',until:'2026-09-30T12:00:00Z'},{...event,id:'past',at:'2026-09-17T12:00:00Z'}],[place],now);
    expect(rows).toHaveLength(1);expect(rows[0].ongoing).toBe(true);
  });
  it("'tonight' is a timed programme of this evening or one on right now, never an all-day listing or a finished matinee",()=>{
    const at=(zagreb:string)=>Date.parse(`2026-09-18T${zagreb}:00+02:00`);
    const show=(start:string,until?:string,precision='time'):FeedItem=>({...event,at:new Date(at(start)).toISOString(),...(until?{until:new Date(at(until)).toISOString()}:{}),data:{...event.data,precision}});
    expect(TONIGHT_FROM_HOUR).toBe(17);
    // At 14:32: tonight's 20:00 concert is on the map, the ended 12:00 matinee is not.
    expect(eventInWindow(show('20:00'),at('14:32'),'tonight')).toBe(true);
    expect(eventInWindow(show('17:00'),at('14:32'),'tonight')).toBe(true);
    expect(eventInWindow(show('12:00'),at('14:32'),'tonight')).toBe(false);
    expect(eventInWindow(show('12:00','13:30'),at('14:32'),'tonight')).toBe(false);
    // An afternoon event that has not started yet is not this evening's; the same one still running at 17:30 is.
    expect(eventInWindow(show('16:00','18:00'),at('14:32'),'tonight')).toBe(false);
    expect(eventInWindow(show('16:00','18:00'),at('17:30'),'tonight')).toBe(true);
    expect(eventInWindow(show('16:00','18:00'),at('18:30'),'tonight')).toBe(false);
    // An all-day exhibition or a festival's date range is not an occasion of the evening.
    expect(eventInWindow(show('00:00','23:59','day'),at('18:00'),'tonight')).toBe(false);
    expect(eventInWindow({...show('10:00',undefined,'range'),until:'2026-09-30T18:00:00Z'},at('18:00'),'tonight')).toBe(false);
    // Tomorrow evening, a concert already over, and an item dated by publication are all out.
    expect(eventInWindow({...show('20:00'),at:new Date(at('20:00')+86_400_000).toISOString()},at('14:32'),'tonight')).toBe(false);
    expect(eventInWindow(show('20:00','22:00'),at('22:30'),'tonight')).toBe(false);
    expect(eventInWindow({...show('20:00'),dateBasis:'published'},at('14:32'),'tonight')).toBe(false);
    // A programme running past midnight is still on: whatever day it began, running now is tonight.
    const run=(start:string,until:string):FeedItem=>({...event,at:start,until,data:{...event.data,precision:'time'}});
    const late=run('2026-09-22T21:00:00Z','2026-09-22T23:00:00Z'); // 22 Sep 23:00 → 23 Sep 01:00 Zagreb
    expect(eventInWindow(late,Date.parse('2026-09-22T22:30:00Z'),'tonight')).toBe(true); // 00:30
    expect(eventInWindow(late,Date.parse('2026-09-22T21:30:00Z'),'tonight')).toBe(true); // 23:30
    expect(eventInWindow(late,Date.parse('2026-09-22T23:30:00Z'),'tonight')).toBe(false); // 01:30, over
    // Spring forward (29 Mar 2026, 02:00 CET → 03:00 CEST): 28 Mar 23:00 CET → 29 Mar 04:00 CEST.
    const spring=run('2026-03-28T22:00:00Z','2026-03-29T02:00:00Z');
    expect(eventInWindow(spring,Date.parse('2026-03-29T00:59:00Z'),'tonight')).toBe(true); // 01:59 CET
    expect(eventInWindow(spring,Date.parse('2026-03-29T01:00:00Z'),'tonight')).toBe(true); // 03:00 CEST, the skipped hour behind it
    expect(eventInWindow(spring,Date.parse('2026-03-29T02:01:00Z'),'tonight')).toBe(false); // 04:01 CEST, over
    // Fall back (25 Oct 2026, 03:00 CEST → 02:00 CET): 24 Oct 23:00 CEST → 25 Oct 03:00 CET; 02:30 happens twice.
    const autumn=run('2026-10-24T21:00:00Z','2026-10-25T02:00:00Z');
    expect(eventInWindow(autumn,Date.parse('2026-10-25T00:30:00Z'),'tonight')).toBe(true); // 02:30 CEST, the first
    expect(eventInWindow(autumn,Date.parse('2026-10-25T01:30:00Z'),'tonight')).toBe(true); // 02:30 CET, the repeat
    expect(eventInWindow(autumn,Date.parse('2026-10-25T02:30:00Z'),'tonight')).toBe(false); // 03:30 CET, over
    // An upcoming programme is read in Zagreb wall time on both DST days: 17:00 is the evening, 16:00 is not.
    expect(eventInWindow(run('2026-03-29T15:00:00Z','2026-03-29T17:00:00Z'),Date.parse('2026-03-29T08:00:00Z'),'tonight')).toBe(true); // 17:00 CEST
    expect(eventInWindow(run('2026-03-29T14:00:00Z','2026-03-29T15:00:00Z'),Date.parse('2026-03-29T08:00:00Z'),'tonight')).toBe(false); // 16:00 CEST
    expect(eventInWindow(run('2026-10-25T16:00:00Z','2026-10-25T18:00:00Z'),Date.parse('2026-10-25T09:00:00Z'),'tonight')).toBe(true); // 17:00 CET
    expect(eventInWindow(run('2026-10-25T15:00:00Z','2026-10-25T15:30:00Z'),Date.parse('2026-10-25T09:00:00Z'),'tonight')).toBe(false); // 16:00 CET
    // Tomorrow's late programme is not tonight's, even a few hours ahead: 23 Sep 17:30 at 22 Sep 23:30.
    expect(eventInWindow(run('2026-09-23T15:30:00Z','2026-09-23T17:00:00Z'),Date.parse('2026-09-22T21:30:00Z'),'tonight')).toBe(false);
    // The other windows answer as before.
    expect(eventInWindow(show('12:00','13:30'),at('14:32'),'today')).toBe(false);
    expect(eventInWindow(show('16:00','18:00'),at('14:32'),'today')).toBe(true);
    expect(eventInWindow(show('00:00','23:59','day'),at('18:00'),'week')).toBe(true);
    expect(locatedEvents([show('20:00'),{...show('12:00'),id:'matinee'}],[place],at('14:32'),'tonight').map(e=>e.item.id)).toEqual(['e1']);
  });
  it('quiet venues are searchable but not default event pins',()=>{
    const city={...emptyCity(),places:[place]},o={group:'living' as const,category:'',window:'week' as const,query:'',center:{lon:15.97,lat:45.81},radius:5000,now};
    expect(discover(city,[],o).places).toHaveLength(0);
    expect(discover(city,[],{...o,query:'Gavella'}).places).toHaveLength(1);
  });
  it('never shows stale bike counts as available now',()=>{
    const city={...emptyCity(),live:{schema:1 as const,generatedAt:new Date(now).toISOString(),sources:[],air:[],consultations:[],bikes:[{id:'1',name:'Trg',lon:15.97,lat:45.81,bikes:3,docks:2,capacity:5,installed:true,renting:true,returning:true,observedAt:new Date(now-900000).toISOString()}]}};
    expect(dynamicPlaces(city,now)[0].facts?.bikes).toBe('?');
  });
  it('street names require exactly one matching settlement',()=>{
    const stories=[{id:'1',name:'Ilica',description:'a',settlement:'Zagreb',settlementId:'1'},{id:'2',name:'Ilica',description:'b',settlement:'Drugo',settlementId:'2'}];
    expect(matchStreet('Ilica',{lon:15.97,lat:45.81},stories,[])).toBeNull();
    expect(matchStreet('Ilica',{lon:15.97,lat:45.81},stories,[{id:'1',name:'Zagreb',polygons:[[[[15,45],[17,45],[17,47],[15,47],[15,45]]]]}])?.id).toBe('1');
  });
  it('new public references remain bounded and reject private parameters',()=>{
    expect(parseSelection({kind:'place',id:'culture-abc'})).toEqual({kind:'place',id:'culture-abc'});
    expect(parseSelection({kind:'street',id:'123',lat:45})).toBeNull();
  });
  it('GTFS uses service day and expires without inventing arrivals',()=>{
    const at=scheduleInstant('2026-09-18',25*3600);
    expect(new Date(at).toISOString()).toBe('2026-09-18T23:00:00.000Z');
    const part={schema:1 as const,operator:'hz' as const,generatedAt:new Date(now).toISOString(),days:['2026-09-18'],validUntil:'2026-09-19T04:00:00Z',stops:{a:{name:'Zagreb',lon:15.9,lat:45.8,runs:[[1,25*3600,'t','r','r','Sesvete'] as [number,number,string,string,string,string]]}}};
    expect(departuresFrom(part,'hz','a',now).departures[0].at).toBe(new Date(at).toISOString());
    expect(departuresFrom(part,'hz','a',now+86400000).status).toBe('down');
  });
});

describe('the HŽ board shows only trains still to come',()=>{
  const i18n=createDefaultI18n('hr');
  const run=(minutes:number,headsign:string)=>({operator:'hz' as const,tripId:`t${minutes}`,routeId:'r',routeName:'r',headsign,at:new Date(now+minutes*60_000).toISOString()});
  const board=(departures:DepartureBoard['departures']):DepartureBoard=>({operator:'hz',stopId:'a',stopName:'Zagreb GK',status:'live',generatedAt:new Date(now).toISOString(),departures});
  it('drops a train that left more than a minute ago and keeps the one just leaving',()=>{
    const html=departuresMarkup(i18n,board([run(-15,'Otisao'),run(-0.5,'Upravo'),run(12,'Sesvete')]),now);
    expect(html).not.toContain('Otisao');
    expect(html).toContain('Upravo');
    expect(html).toContain('Sesvete');
    expect(html).toContain('Sljedeći polasci');
  });
  it('says the board is empty rather than printing a page of departed trains',()=>{
    expect(departuresMarkup(i18n,board([run(-20,'Otisao')]),now)).toContain('Nema potvrđenog rasporeda za ovo razdoblje.');
  });
});
