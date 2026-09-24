import {describe,it,expect} from 'vitest';
import {searchCity,groupWifi} from '../../app/src/city/search';
import {discover} from '../../app/src/city/discovery';
import {emptyCity,type Place} from '../../shared/city/types';
import {createDefaultI18n} from '../../app/src/i18n/create-default-i18n';
import {MAP_PRESENTATIONS} from '../../app/src/map/presentation';
import {bikeCount} from '../../app/src/city/strings';

const now=Date.parse('2026-09-20T12:00:00Z');
const wifi:Place={id:'wifi-a',category:'wifi',name:'Hotspot',address:'Trg bana Jelačića',sourceId:'wifi',sourceRecord:'a',lon:15.977,lat:45.813};
it('uses readable bike-count nouns in both languages',()=>{
  const hr=createDefaultI18n('hr'),en=createDefaultI18n('en');
  expect([1,2,5,11,21].map(n=>bikeCount(hr,n))).toEqual(['1 bicikl','2 bicikla','5 bicikala','11 bicikala','21 bicikl']);
  expect(bikeCount(en,1)).toBe('1 bike');
  expect(bikeCount(en,4)).toBe('4 bikes');
});
it('says an unknown bike count as a dash and the noun, never "?" (city.bikeCountUnknown)',()=>{
  const hr=createDefaultI18n('hr'),en=createDefaultI18n('en');
  for(const value of [undefined,null,Number.NaN,'5']){
    expect(bikeCount(hr,value)).toBe('– bicikala');
    expect(bikeCount(en,value)).toBe('– bikes');
  }
  expect(bikeCount({getLocale:()=>'en-GB'},3)).toBe('3 bikes');
});
describe('one ranked city search',()=>{
  it('puts the named stop before incidental address matches and groups only co-located Wi-Fi',()=>{
    const places=[wifi,{...wifi,id:'wifi-b',lon:15.9771},{...wifi,id:'wifi-c',lon:16.1},{...wifi,id:'heritage-a',category:'heritage' as const}];
    const result=searchCity('Trg bana',[],[{id:'106_1',ids:['106_1'],name:'Trg bana J. Jelačića',lon:15.977,lat:45.813,routes:['6']}],places,[]);
    expect(result[0]).toMatchObject({kind:'stop',id:'106_1'});
    expect(result.filter(r=>r.kind==='place').map(r=>r.id).sort()).toEqual(['heritage-a','wifi-a','wifi-c']);
    expect(groupWifi([{...wifi,lon:undefined},{...wifi,id:'unknown',lon:undefined}])).toHaveLength(2);
  });
  it('keeps exact route numbers ahead of prefixes and name matches ahead of streets mentioning them',()=>{
    const result=searchCity('6',[{id:'6',short:'6',long:'Route six',type:0},{id:'60',short:'60',long:'Route sixty',type:3}],[],[{...wifi,name:'A6',id:'wifi-6'}],[]);
    expect(result[0]).toMatchObject({kind:'route',id:'6'});
    expect(searchCity('Gavella',[],[],[{...wifi,category:'culture',name:'Gavella'}],[{id:'street-a',name:'Other street',description:'Gavella',settlement:'Zagreb',settlementId:'1'}])[0]?.kind).toBe('place');
  });
  it('ranks the stops whose word starts with the query above the streets whose name starts with it, the stop with most lines first: "Jela" at Trg finds Trg bana J. Jelačića before Jelašićka ulica (round 1 finding F2)',()=>{
    const stops=[
      {id:'791_23',ids:['791_23'],name:'Bana Josipa Jelačića',lon:15.98,lat:45.81,routes:['177']},
      {id:'106_1',ids:['106_1','106_2'],name:'Trg bana J. Jelačića',lon:15.977,lat:45.813,routes:['6','11','12','13','14','17']},
    ];
    const streets=[
      {id:'s1',name:'Jelašićka ulica',settlement:'Zagreb',settlementId:'1',description:''},
      {id:'s2',name:'Jelašićka III.',settlement:'Zagreb',settlementId:'1',description:''},
      {id:'s3',name:'Ulica Jelačićeva',settlement:'Zagreb',settlementId:'1',description:''},
    ];
    const result=searchCity('Jela',[],stops,[{...wifi,category:'culture' as const,name:'Galerija Remek djela'}],streets);
    expect(result.slice(0,2).map(r=>[r.kind,r.id])).toEqual([['stop','106_1'],['stop','791_23']]);
    expect(result.slice(2,5).every(r=>r.kind==='street')).toBe(true);
    // A name that starts with the query still beats one that only contains it, and an exact street name beats a stop's word start.
    expect(result.slice(2,4).map(r=>r.id).sort()).toEqual(['s1','s2']);
    expect(result.at(-1)?.name).toBe('Galerija Remek djela');
    expect(searchCity('Ilica',[],[{id:'x',ids:['x'],name:'Ilica Črnomerec',lon:15.9,lat:45.8,routes:['6']}],[],[{id:'ilica',name:'Ilica',settlement:'Zagreb',settlementId:'1',description:''}])[0]).toMatchObject({kind:'street',id:'ilica'});
  });
  it('merges the access points of one name across a square and lists no place a query does not name or address (round 1, desktop F8)',()=>{
    const hotspots=[0,1,2,3,4].map(i=>({...wifi,id:`w${i}`,name:'Wi-Fi Trg Bana Josipa Jelačića',address:`Trg bana Josipa Jelačića ${i+1}`,lon:15.977+i*0.0006,lat:45.813}));
    expect(groupWifi(hotspots)).toHaveLength(1);
    const far={...wifi,id:'w-far',name:'Wi-Fi Trg Bana Josipa Jelačića',address:'Ilica 200',lon:15.95,lat:45.813};
    expect(groupWifi([...hotspots,far])).toHaveLength(2);
    const unrelated={...wifi,id:'u',name:'Knjižnica Bogdana Ogrizovića',address:'Preradovićeva 5',category:'culture' as const};
    const result=searchCity('Trg bana',[],[],[...hotspots,unrelated],[]);
    expect(result.filter(r=>r.kind==='place').map(r=>r.id)).toEqual(['w0']);
    expect(searchCity('Jela',[],[],[unrelated],[{id:'s',name:'Ulica grada Vukovara',settlement:'Zagreb',settlementId:'1',description:'nema veze'}])).toEqual([]);
  });
  it('finds useful categories without requiring the category term in the name',()=>{
    const state={...emptyCity(),places:[{...wifi,category:'toilet' as const,name:'Centar',address:'Ilica'}]};
    expect(discover(state,[],{group:'living',category:'',query:'javni wc',window:'week',center:{lon:15.977,lat:45.813},radius:5000,now}).places).toHaveLength(1);
  });
});

// The wall's passive 20-second sequence is gone (WP1): the header sentence and
// the "U blizini" list replace it, tested in test/app/kiosk-sentence.test.ts and
// test/app/kiosk-nearby.test.ts. What stays here is the map presentations' own
// readability rule.
describe('map presentations',()=>{
  it('keeps the handheld hit target at 44 px',()=>{
    expect(MAP_PRESENTATIONS.handheld.hitTolerancePx*2).toBeGreaterThanOrEqual(44);
  });
});
