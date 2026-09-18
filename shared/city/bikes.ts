import type {Place} from './types';
/** Sensor inventory is not an offer to rent/return at a disabled station. */
export function bikeAvailability(place:Place,mode:'rent'|'return'='rent'):string{
  if(!place.facts?.fresh)return '?';
  if(!(mode==='return'?place.facts.returning:place.facts.operational))return '—';
  return String((mode==='return'?place.facts.docks:place.facts.bikes)??'?');
}
