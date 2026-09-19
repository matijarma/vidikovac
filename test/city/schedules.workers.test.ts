import {describe,it,expect} from 'vitest';
import {Buffer} from 'node:buffer';
import {deflateRawSync} from 'node:zlib';
import {buildSchedule,departuresFrom,stopShard} from '../../worker/city/schedules';

describe('GTFS on the Worker runtime',()=>{
  it('streams deflated CSV through the Workers Node compatibility layer',async()=>{
    const files={
      'calendar_dates.txt':'service_id,date,exception_type\ns,20260918,1\n',
      'routes.txt':'route_id,route_short_name,route_long_name\nr,1,Zagreb\n',
      'trips.txt':'route_id,service_id,trip_id,trip_headsign\nr,s,t,Sesvete\n',
      'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\na,Zagreb,45.81,15.97\nb,Sesvete,45.82,16.1\n',
      'stop_times.txt':'trip_id,departure_time,stop_id,stop_sequence\nt,20:00:00,a,1\nt,20:30:00,b,2\n',
    };
    const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
    for(const [filename,text] of Object.entries(files)){
      const name=Buffer.from(filename),plain=Buffer.from(text),body=deflateRawSync(plain),header=Buffer.alloc(30),entry=Buffer.alloc(46);
      header.writeUInt32LE(0x04034b50);header.writeUInt16LE(8,8);header.writeUInt32LE(body.length,18);header.writeUInt32LE(plain.length,22);header.writeUInt16LE(name.length,26);
      entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(8,10);entry.writeUInt32LE(body.length,20);entry.writeUInt32LE(plain.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
      local.push(header,name,body);central.push(entry,name);offset+=header.length+name.length+body.length;
    }
    const directory=Buffer.concat(central),end=Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);end.writeUInt16LE(5,8);end.writeUInt16LE(5,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
    const now=Date.parse('2026-09-18T12:00:00Z'),schedule=await buildSchedule(Buffer.concat([...local,directory,end]),'hz',now);
    const board=departuresFrom(schedule.parts[Number(stopShard('a'))],'hz','a',now);
    expect(board.departures).toHaveLength(1);expect(board.departures[0].at).toBe('2026-09-18T18:00:00.000Z');
  });
});
