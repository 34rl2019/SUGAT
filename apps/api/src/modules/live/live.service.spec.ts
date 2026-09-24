import { LiveService } from './live.service';
import { EtaService } from './eta.service';
const stop=(id:string,sequence:number,latitude:number)=>({id:`rs-${id}`,stopId:id,sequence,boardingAllowed:true,dropoffAllowed:true,stop:{id,name:id,active:true,latitude,longitude:124}});
const trip=(stops:any[],lastPassedSequence=0)=>({id:'trip',vehicleId:'vehicle',status:'ACTIVE',lastPassedSequence,scheduledDepartureAt:new Date(),currentLocation:{latitude:10.05,longitude:124,speed:10,recordedAt:new Date()},vehicle:{type:'BUS',displayName:'BUS 104',bodyNumber:'104'},route:{name:'Tacloban → Sogod',direction:'Southbound',stops}});
describe('public route-order search',()=>{
 it('returns FULL trips with initial location/occupancy while withholding private identity and conduction sticker',async()=>{const value={...trip([stop('A',1,10.05),stop('B',2,9.5)]),occupancyStatus:'FULL',occupancyUpdatedAt:new Date()};(value.vehicle as any).conductionSticker='private-to-detail';const db:any={trip:{findMany:jest.fn().mockResolvedValue([value])}};const results=await new LiveService(db,new EtaService()).search('A','B');expect(results).toHaveLength(1);expect(results[0]).toMatchObject({tripId:'trip',vehicleId:'vehicle',occupancyStatus:'FULL',location:{latitude:10.05,longitude:124}});expect(results[0].vehicle).not.toHaveProperty('conductionSticker');expect(results[0]).not.toHaveProperty('driver');expect(db.trip.findMany.mock.calls[0][0].where.status).toBe('ACTIVE')});
 it('keeps unknown historical occupancy neutral',async()=>{const db:any={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('A',1,10.05),stop('B',2,9.5)])])}};expect((await new LiveService(db,new EtaService()).search('A','B'))[0].occupancyStatus).toBeNull()});
 it('uses registered vehicle identity in detail and exposes optional conduction sticker only there',async()=>{const value={...trip([stop('A',1,10.05),stop('B',2,9.5)]),vehicle:{type:'VAN',displayName:'Registered Van',plateNumber:'TEST-123',conductionSticker:'TEST-STICKER'}};const db:any={trip:{findFirst:jest.fn().mockResolvedValue(value)}};const detail=await new LiveService(db,new EtaService()).getTrip('trip','A','B');expect(detail.vehicle).toEqual(value.vehicle);expect(db.trip.findFirst.mock.calls[0][0].include.vehicle.select).toMatchObject({displayName:true,plateNumber:true,conductionSticker:true});expect(detail).not.toHaveProperty('driver')});
 it('matches intermediate stops in forward order without passenger authentication',async()=>{const db={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('Tacloban',1,11),stop('Baybay',2,10),stop('Sogod',3,9.5)])])}}as any;const result=await new LiveService(db,new EtaService()).search('Baybay','Sogod');expect(result).toHaveLength(1);expect(result[0].boardingStop.name).toBe('Baybay');});
 it('rejects reverse direction',async()=>{const db={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('Tacloban',1,11),stop('Baybay',2,10),stop('Sogod',3,9.5)])])}}as any;expect(await new LiveService(db,new EtaService()).search('Sogod','Baybay')).toEqual([]);});
 it('rejects a boarding stop already passed',async()=>{const db={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('Baybay',2,10),stop('Sogod',3,9.5)],2)])}}as any;expect(await new LiveService(db,new EtaService()).search('Baybay','Sogod')).toEqual([]);});
 it('only exposes passengers and detail stops inside the active segment',async()=>{
  const value={...trip([stop('A',1,11),stop('B',2,10.05),stop('C',3,9.5),stop('D',4,9)]),events:[{metadata:{startStopId:'B',destinationStopId:'C'}}]};
  const db:any={trip:{findMany:jest.fn().mockResolvedValue([value]),findFirst:jest.fn().mockResolvedValue(value)}};const service=new LiveService(db,new EtaService());
  expect(await service.search('A','C')).toEqual([]);expect(await service.search('B','D')).toEqual([]);
  const matches=await service.search('B','C');expect(matches).toHaveLength(1);expect(matches[0].route.stops.map(s=>s.stop.id)).toEqual(['B','C']);
  const detail=await service.getTrip('trip','B','C');expect(detail.route.stops.map(s=>s.stopId)).toEqual(['B','C']);expect(detail.nextStop?.id).toBe('B');
  await expect(service.getTrip('trip','A','C')).rejects.toMatchObject({status:400});
 });
 it.each(['inactive','boarding','dropoff'])('hides endpoints with invalid %s permission',async(reason)=>{
  const stops=[stop('A',1,10.05),stop('B',2,9.5)];if(reason==='inactive')stops[0].stop.active=false;if(reason==='boarding')stops[0].boardingAllowed=false;if(reason==='dropoff')stops[1].dropoffAllowed=false;
  const db:any={trip:{findMany:jest.fn().mockResolvedValue([trip(stops)])}};expect(await new LiveService(db,new EtaService()).search('A','B')).toEqual([]);
 });

});
