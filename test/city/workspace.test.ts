// @vitest-environment happy-dom
import {describe,expect,it,vi} from 'vitest';
import {createTransportWorkspace} from '../../app/src/transport/workspace';
import {createMapSlots} from '../../app/src/map/map-slots';
import {createDefaultI18n} from '../../app/src/i18n/create-default-i18n';
import {emptyCity} from '../../shared/city/types';
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
    expect(drawn).toEqual([]);
    const culture=workspace.element.querySelector<HTMLButtonElement>('[data-action=city-group][data-group=culture]')!;
    culture.focus();culture.click();
    expect(document.activeElement).toBe(culture);
    const input=workspace.element.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
    input.value='Gavella';input.dispatchEvent(new Event('input',{bubbles:true}));
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
  it('uses native focusable buttons for mixed city/transport search without orphaned option ARIA',()=>{
    const workspace=createTransportWorkspace({loadStops:async()=>[]}),disposal:(()=>void)[]=[];
    const ctx:LayerContext={i18n:createDefaultI18n('hr'),snapshots:{},now:Date.now(),city:emptyCity(),onDispose:fn=>disposal.push(fn)};
    document.body.replaceChildren(workspace.element);workspace.render({ctx,points:[],lines:[]});
    const input=workspace.element.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
    input.value='6';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(workspace.element.querySelector('[role=option]')).toBeNull();
    expect(workspace.element.querySelector('li[aria-selected]')).toBeNull();
    expect(workspace.element.querySelector('button[data-action=select-route]')).not.toBeNull();
    workspace.element.querySelector<HTMLButtonElement>('button[data-action=select-route]')!.click();
    expect(workspace.element.dataset.cityGroup).toBe('transport');
    disposal.forEach(fn=>fn());
  });
});
