// @vitest-environment happy-dom
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import {describe,expect,it,vi} from 'vitest';
import {createTransportWorkspace} from '../../app/src/transport/workspace';
import {createMapSlots} from '../../app/src/map/map-slots';
import {createDefaultI18n} from '../../app/src/i18n/create-default-i18n';
import {emptyCity,type CityState} from '../../shared/city/types';
import type {FeedItem} from '../../worker/feed/schema';
import type {LayerContext} from '../../app/src/layers/types';
import type {MapPoint} from '../../app/src/map/city-map';

describe('persistent city workspace',()=>{
  it('keeps a selected quiet venue on the map after clearing search and refreshing',()=>{
    let drawn:MapPoint[]=[];
    const handle={update:vi.fn((points:MapPoint[])=>{drawn=points;}),pause(){},resume(){},destroy(){},select:vi.fn(),status:()=>'ready' as const,setModes:vi.fn()};
    const maps=createMapSlots(options=>{drawn=options.points??[];return handle;});
    const disposal:(()=>void)[]=[];
    const ctx:LayerContext={i18n:createDefaultI18n('hr'),snapshots:{},now:Date.parse('2026-09-18T12:00:00Z'),maps,
      city:{...emptyCity(),places:[{id:'culture-a',name:'Gavella',category:'culture',sourceId:'culture',sourceRecord:'a',lon:15.97,lat:45.81}]},
      navigate:vi.fn(),onDispose:fn=>disposal.push(fn)};
    const workspace=createTransportWorkspace({loadStops:async()=>[]});document.body.replaceChildren(workspace.element);
    workspace.render({ctx,points:[],lines:[]});
    // A venue with no programme tonight is not one of the map's curated marks.
    expect(drawn).toEqual([]);
    // There is no group to pick: the one search field finds the venue, and the map draws it while it is typed.
    expect(workspace.element.querySelector('[data-action=city-group], details')).toBeNull();
    const input=workspace.element.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
    input.value='Gavella';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(drawn.map(p=>p.id)).toContain('culture-a');
    workspace.element.querySelector<HTMLButtonElement>('[data-action=select-place]')!.click();
    expect(input.value).toBe('');
    workspace.render({ctx:{...ctx,now:ctx.now+60000},points:[],lines:[]});
    expect(drawn.map(p=>p.id)).toContain('culture-a');
    expect(workspace.element.querySelector('[data-testid=city-detail]')?.textContent).toContain('Gavella');
    disposal.forEach(fn=>fn());maps.destroy();
  });
  it('keeps one board cache for every platform it asks about and destroys it with the workspace',()=>{
    const cache={get:vi.fn(()=>undefined),ensure:vi.fn(),destroy:vi.fn()};
    const disposal:(()=>void)[]=[];
    const ctx:LayerContext={i18n:createDefaultI18n('hr'),snapshots:{},now:Date.parse('2026-09-18T12:00:00Z'),city:emptyCity(),onDispose:fn=>disposal.push(fn)};
    const workspace=createTransportWorkspace({loadStops:async()=>[],createBoards:()=>cache});
    document.body.replaceChildren(workspace.element);workspace.render({ctx,points:[],lines:[]});
    expect(cache.destroy).not.toHaveBeenCalled();
    disposal.forEach(fn=>fn());
    expect(cache.destroy).toHaveBeenCalledTimes(1);
  });
  it('uses one combobox and owned listbox for every kind of result',()=>{
    const workspace=createTransportWorkspace({loadStops:async()=>[]}),disposal:(()=>void)[]=[];
    const ctx:LayerContext={i18n:createDefaultI18n('hr'),snapshots:{},now:Date.now(),city:emptyCity(),onDispose:fn=>disposal.push(fn)};
    document.body.replaceChildren(workspace.element);workspace.render({ctx,points:[],lines:[]});
    const input=workspace.element.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
    input.value='6';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(workspace.element.querySelector('[role=option]')?.closest('[role=listbox]')?.id).toBe(input.getAttribute('aria-controls'));
    expect(workspace.element.querySelector('li[aria-selected]')).toBeNull();
    expect(workspace.element.querySelector('[role=option][data-action=select-route]')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    expect(input.getAttribute('aria-activedescendant')).toBe(workspace.element.querySelector('[role=option]')?.id);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    expect(workspace.element.querySelector('[data-testid=route-title]')?.textContent).toContain('6');
    disposal.forEach(fn=>fn());
  });
  it('draws the curated city at once, with no tap: every BAJS station with its count and tonight’s venues; a category is a search, drawn only while it is typed',()=>{
    const now=Date.parse('2026-09-18T12:00:00Z'); // 14:00 in Zagreb
    const observedAt=new Date(now-60_000).toISOString();
    const city:CityState={...emptyCity(),
      places:[
        {id:'culture-a',name:'Gavella',category:'culture',sourceId:'culture',sourceRecord:'a',lon:15.97,lat:45.81},
        {id:'culture-b',name:'Mala scena',category:'culture',sourceId:'culture',sourceRecord:'b',lon:15.975,lat:45.812},
        {id:'toilets-1',name:'Javni WC Zrinjevac',category:'toilet',sourceId:'toilets',sourceRecord:'1',lon:15.978,lat:45.81},
      ],
      live:{schema:1 as never,generatedAt:observedAt,sources:[{id:'bajs',name:'BAJS',url:'https://example.test/',licence:'x',status:'live',count:1}],
        bikes:[{id:'b1',name:'BAJS Trg',lon:15.977,lat:45.813,bikes:4,docks:2,capacity:6,installed:true,renting:true,returning:true,observedAt}],air:[],consultations:[]}};
    const tonight:FeedItem={id:'kvartovske:predstava',module:'dogadanja',tier:'open',kind:'event',title:'Predstava',at:'2026-09-18T18:00:00Z',dateBasis:'event',data:{source:'kvartovske',venue:'Gavella',precision:'time'}};
    const dogadanja={module:'dogadanja' as const,tier:'session' as const,status:'live' as const,fetchedAt:observedAt,attribution:{text:'',url:'',licence:''},items:[tonight]};
    let drawn:MapPoint[]=[];
    const setModes=vi.fn();
    const handle={update:vi.fn((points:MapPoint[])=>{drawn=points;}),pause(){},resume(){},destroy(){},select:vi.fn(),status:()=>'ready' as const,setModes};
    let options:{modes?:ReadonlySet<number>|null}={};
    const maps=createMapSlots(o=>{drawn=o.points??[];options=o;return handle;});
    const disposal:(()=>void)[]=[];
    const ctx:LayerContext={i18n:createDefaultI18n('hr'),snapshots:{dogadanja},now,maps,city,navigate:vi.fn(),onDispose:fn=>disposal.push(fn)};
    const workspace=createTransportWorkspace({loadStops:async()=>[]});document.body.replaceChildren(workspace.element);
    workspace.render({ctx,points:[],lines:[]});
    const ids=():string[]=>drawn.map(p=>p.id).sort();
    expect(ids()).toEqual(['bajs-b1','culture-a']);
    expect(drawn.find(p=>p.id==='bajs-b1')?.props).toMatchObject({category:'bikes',badge:'4',spent:false});
    expect(drawn.find(p=>p.id==='culture-a')?.props).toMatchObject({badge:'1',eventCount:1});
    expect(drawn.some(p=>p.id.startsWith('cluster-'))).toBe(false);
    // Every mode at once: the map is told nothing to leave out.
    expect(options.modes??null).toBeNull();
    const input=workspace.element.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
    input.value='wc';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(ids()).toEqual(['bajs-b1','culture-a','toilets-1']);
    expect(workspace.element.querySelector('[data-action=select-place][data-id="toilets-1"]')).not.toBeNull();
    workspace.element.querySelector<HTMLButtonElement>('[data-action=clear-search]')!.click();
    expect(ids()).toEqual(['bajs-b1','culture-a']);
    workspace.render({ctx:{...ctx,now:now+60_000},points:[],lines:[]});
    expect(ids()).toEqual(['bajs-b1','culture-a']);
    disposal.forEach(fn=>fn());maps.destroy();
  });
});
