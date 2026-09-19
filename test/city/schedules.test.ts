import {describe,expect,it} from 'vitest';
import {DEPARTURES_PAST_WINDOW_MS,buildSchedule,departuresFrom,scheduleInstant,stopShard} from '../../worker/city/schedules';
/** Minimal stored ZIP fixtures exercise the same streamed CSV reader as imports. */
function zip(files:Record<string,string>):Uint8Array{
  const locals:Buffer[]=[],directory:Buffer[]=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const filename=Buffer.from(name),body=Buffer.from(text),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,filename,body);directory.push(central,filename);offset+=30+filename.length+body.length;
  }
  const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,dir,end]);
}
const NOW=Date.parse('2026-09-18T12:00:00Z');
const files={
  'calendar_dates.txt':'service_id,date,exception_type\ns,20260918,1\n',
  'routes.txt':'route_id,route_short_name,route_long_name\nr,1,"Zagreb,\nSesvete"\n',
  'trips.txt':'route_id,service_id,trip_id,trip_headsign\nr,s,t,"Sesvete"\n',
  'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\na,Zagreb,45.81,15.97\nb,Drugi,45.82,15.98\nc,Sesvete,45.83,16.1\n',
  'stop_times.txt':'trip_id,departure_time,stop_id,stop_sequence,pickup_type\nt,25:30:00,a,1,0\nt,25:40:00,b,2,1\nt,26:00:00,c,3,0\n',
};
describe('rolling GTFS import',()=>{
  it('reads multiline CSV, honours pickup flags and does not offer terminal arrivals as departures',async()=>{
    const result=await buildSchedule(zip(files),'hz',NOW);
    const part=result.parts[Number(stopShard('a'))];
    expect(part.stops.a.runs).toHaveLength(1);
    expect(result.parts[Number(stopShard('b'))].stops.b.runs).toHaveLength(0);
    expect(result.parts[Number(stopShard('c'))].stops.c.runs).toHaveLength(0);
    expect(part.validUntil).toBe('2026-09-18T23:30:01.000Z');
    const board=departuresFrom(part,'hz','a',Date.parse('2026-09-18T23:00:00Z'));
    expect(board.status).toBe('live');expect(board.departures[0].at).toBe('2026-09-18T23:30:00.000Z');
  });
  // A board of nothing but future departures drops a trip the moment its
  // scheduled minute passes -- which is exactly when a late tram is closest
  // and the rider most wants it (WP5, the join-rate probe's largest miss).
  // The board therefore carries a quarter of an hour of scheduled past, and
  // shared/city/arrivals.ts decides which of those rows has actually gone.
  it('carries a quarter of an hour of scheduled past so a late trip is still on the board',()=>{
    const day='2026-09-18';
    const run=(seconds:number,tripId:string):[number,number,string,string,string,string]=>[1,seconds,tripId,'r','1','Sesvete'];
    const part={schema:1 as const,operator:'zet' as const,generatedAt:'2026-09-18T00:00:00Z',days:[day],validUntil:'2026-09-19T04:00:00Z',
      stops:{a:{name:'Trg',lon:15.97,lat:45.81,runs:[
        run(11*3600+40*60,'gone'),run(11*3600+44*60,'gone-too'),
        run(11*3600+46*60,'late'),run(11*3600+58*60,'just-left'),
        run(12*3600+1*60,'next'),run(12*3600+9*60,'after'),
      ]}}};
    const now=scheduleInstant(day,12*3600);
    expect(DEPARTURES_PAST_WINDOW_MS).toBe(15*60_000);
    const board=departuresFrom(part,'zet','a',now);
    // Sixteen and twenty minutes gone are off the board; fourteen and two are on it.
    expect(board.departures.map(d=>d.tripId)).toEqual(['late','just-left','next','after']);
    expect(Date.parse(board.departures[0].at)).toBe(now-14*60_000);
  });

  it('counts its twelve rows from the first one still inside the window, so the future is not starved',()=>{
    const day='2026-09-18';
    // A platform every two minutes: seven rows of scheduled past, and the cap
    // still leaves the rider five rows of future.
    const runs=Array.from({length:20},(_,i):[number,number,string,string,string,string]=>[1,11*3600+46*60+i*120,`t${i}`,'r','1','Sesvete']);
    const part={schema:1 as const,operator:'zet' as const,generatedAt:'2026-09-18T00:00:00Z',days:[day],validUntil:'2026-09-19T04:00:00Z',
      stops:{a:{name:'Trg',lon:15.97,lat:45.81,runs}}};
    const now=scheduleInstant(day,12*3600);
    const board=departuresFrom(part,'zet','a',now);
    expect(board.departures).toHaveLength(12);
    expect(board.departures[0].tripId).toBe('t0');
    expect(board.departures.filter(d=>Date.parse(d.at)>=now)).toHaveLength(5);
  });

  it('rejects malformed, unsupported and expired archives',async()=>{
    await expect(buildSchedule(new Uint8Array(5),'hz',NOW)).rejects.toThrow('gtfs-zip-size');
    const broken=zip(files);broken[broken.length-22+16]=255;
    await expect(buildSchedule(broken,'hz',NOW)).rejects.toThrow('gtfs-zip-directory');
    await expect(buildSchedule(zip(files),'hz',NOW+20*86400000)).rejects.toThrow('gtfs-no-current-service');
    await expect(buildSchedule(zip({...files,'routes.txt':'route_id,name\nr,"unclosed'}),'hz',NOW)).rejects.toThrow('gtfs-unterminated-quote');
  });
});
