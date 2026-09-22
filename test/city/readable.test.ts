import {describe,it,expect} from 'vitest';
import {searchCity,groupWifi} from '../../app/src/city/search';
import {discover} from '../../app/src/city/discovery';
import {emptyCity,type Place} from '../../shared/city/types';
import {createDefaultI18n} from '../../app/src/i18n/create-default-i18n';
import {MAP_PRESENTATIONS} from '../../app/src/map/presentation';
import {clusterLabel} from '../../app/src/motion/pills';
import {bikeCount} from '../../app/src/city/strings';

const now=Date.parse('2026-09-20T12:00:00Z');
const wifi:Place={id:'wifi-a',category:'wifi',name:'Hotspot',address:'Trg bana Jelačića',sourceId:'wifi',sourceRecord:'a',lon:15.977,lat:45.813};
it('uses readable bike-count nouns in both languages',()=>{
  const hr=createDefaultI18n('hr'),en=createDefaultI18n('en');
  expect([1,2,5,11,21].map(n=>bikeCount(hr,n))).toEqual(['1 bicikl','2 bicikla','5 bicikala','11 bicikala','21 bicikl']);
  expect(bikeCount(en,1)).toBe('1 bike');
  expect(bikeCount(en,4)).toBe('4 bikes');
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
  it('bound route summaries without losing individual numbers and keep the handheld hit target at 44 px',()=>{
    for(const profile of Object.values(MAP_PRESENTATIONS)){
      expect(clusterLabel(['6'],profile.clusterMaxNumbers)).toBe('6');
      expect(clusterLabel(['109','113','119','120','121'],profile.clusterMaxNumbers).length).toBeLessThanOrEqual(12);
    }
    expect(MAP_PRESENTATIONS.handheld.hitTolerancePx*2).toBeGreaterThanOrEqual(44);
  });
});
