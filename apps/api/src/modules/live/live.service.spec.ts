import { LiveService } from './live.service';
import { EtaService } from './eta.service';
const stop=(id:string,sequence:number,latitude:number)=>({id:`rs-${id}`,stopId:id,sequence,boardingAllowed:true,dropoffAllowed:true,stop:{id,name:id,latitude,longitude:124}});
const trip=(stops:any[],lastPassedSequence=0)=>({id:'trip',vehicleId:'vehicle',status:'ACTIVE',lastPassedSequence,scheduledDepartureAt:new Date(),currentLocation:{latitude:10.05,longitude:124,speed:10,recordedAt:new Date()},vehicle:{type:'BUS',displayName:'BUS 104',bodyNumber:'104'},route:{name:'Tacloban → Sogod',direction:'Southbound',stops}});
describe('public route-order search',()=>{
 it('matches intermediate stops in forward order without passenger authentication',async()=>{const db={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('Tacloban',1,11),stop('Baybay',2,10),stop('Sogod',3,9.5)])])}}as any;const result=await new LiveService(db,new EtaService()).search('Baybay','Sogod');expect(result).toHaveLength(1);expect(result[0].boardingStop.name).toBe('Baybay');});
 it('rejects reverse direction',async()=>{const db={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('Tacloban',1,11),stop('Baybay',2,10),stop('Sogod',3,9.5)])])}}as any;expect(await new LiveService(db,new EtaService()).search('Sogod','Baybay')).toEqual([]);});
 it('rejects a boarding stop already passed',async()=>{const db={trip:{findMany:jest.fn().mockResolvedValue([trip([stop('Baybay',2,10),stop('Sogod',3,9.5)],2)])}}as any;expect(await new LiveService(db,new EtaService()).search('Baybay','Sogod')).toEqual([]);});
});
