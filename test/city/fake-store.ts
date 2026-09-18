import { emptyCity,type CityState } from '../../shared/city/types';
import type { CityStore } from '../../app/src/core/city-store';
export function fakeCityStore(initial:CityState=emptyCity()):CityStore & {set(next:CityState):void}{
  let state=initial; const listeners=new Set<()=>void>();
  return {snapshot:()=>state,start:async()=>{},ensure:async()=>{},refresh:async()=>{},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},pause(){},destroy(){listeners.clear();},
    set(next){state=next;listeners.forEach(fn=>fn());}};
}
