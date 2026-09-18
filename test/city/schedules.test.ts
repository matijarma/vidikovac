import {describe,expect,it} from 'vitest';
import {buildSchedule,departuresFrom,stopShard} from '../../worker/city/schedules';
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
  it('rejects malformed, unsupported and expired archives',async()=>{
    await expect(buildSchedule(new Uint8Array(5),'hz',NOW)).rejects.toThrow('gtfs-zip-size');
    const broken=zip(files);broken[broken.length-22+16]=255;
    await expect(buildSchedule(broken,'hz',NOW)).rejects.toThrow('gtfs-zip-directory');
    await expect(buildSchedule(zip(files),'hz',NOW+20*86400000)).rejects.toThrow('gtfs-no-current-service');
    await expect(buildSchedule(zip({...files,'routes.txt':'route_id,name\nr,"unclosed'}),'hz',NOW)).rejects.toThrow('gtfs-unterminated-quote');
  });
});
