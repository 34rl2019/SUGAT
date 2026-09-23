import { EtaService, type EtaRouteStop } from './eta.service';

const eta=new EtaService();
const stops:EtaRouteStop[]=[
 {sequence:1,minutesFromPrevious:null,stop:{id:'a',name:'A',latitude:10,longitude:124}},
 {sequence:2,minutesFromPrevious:10,stop:{id:'b',name:'B',latitude:10,longitude:124.1}},
 {sequence:3,minutesFromPrevious:20,stop:{id:'c',name:'C',latitude:10,longitude:124.2}},
 {sequence:4,minutesFromPrevious:15,stop:{id:'d',name:'D',latitude:10,longitude:124.3}},
];
const location=(longitude:number,speed:number|null=0)=>({latitude:10,longitude,speed,recordedAt:new Date('2026-09-05T00:00:00Z')});

describe('route-aware ETA',()=>{
 it('uses ordered segment timings for different passenger boarding stops',()=>{const b=eta.context(stops,1,location(124), 'LIVE',2,4),c=eta.context(stops,1,location(124),'LIVE',3,4);expect(b.boardingEta.seconds).toBe(600);expect(c.boardingEta.seconds).toBe(1800);expect(c.boardingEta.seconds).toBeGreaterThan(b.boardingEta.seconds!);});
 it('interpolates the current segment geometrically',()=>{expect(eta.calculate(stops,1,location(124.05),2,'LIVE').seconds).toBeCloseTo(300,-1);});
 it('uses the first outbound segment after leaving the initial stop radius',()=>{const nearStart=eta.calculate(stops,0,location(124.002),2,'LIVE'),halfway=eta.calculate(stops,0,location(124.05),2,'LIVE');expect(halfway.seconds).toBeLessThan(nearStart.seconds!);expect(eta.calculate(stops,0,location(124.05),1,'LIVE').status).not.toBe('BOARDING_STOP_PASSED');});
 it('uses expected segment time and exposes confidence for zero, missing, and invalid speed',()=>{expect(eta.calculate(stops,1,location(124),2,'LIVE')).toMatchObject({seconds:600,status:'APPROXIMATE',reason:'VEHICLE_STOPPED'});expect(eta.calculate(stops,1,location(124,null),2,'LIVE')).toMatchObject({seconds:600,status:'AVAILABLE'});expect(eta.calculate(stops,1,location(124,100),2,'LIVE')).toMatchObject({seconds:600,status:'APPROXIMATE',reason:'SPEED_UNRELIABLE'});});
 it('reports arrival at the target stop',()=>expect(eta.calculate(stops,1,location(124.1),2,'LIVE')).toMatchObject({seconds:0,status:'AVAILABLE',display:'Arriving now'}));
 it('degrades stale and suppresses offline or missing-location precision',()=>{expect(eta.calculate(stops,1,location(124),2,'STALE').status).toBe('APPROXIMATE');expect(eta.calculate(stops,1,location(124),2,'OFFLINE')).toMatchObject({status:'UNAVAILABLE',seconds:null});expect(eta.calculate(stops,1,null,2,'LIVE')).toMatchObject({status:'UNAVAILABLE',reason:'NO_CURRENT_LOCATION'});});
 it('never regresses behind monotonic route progression',()=>expect(eta.calculate(stops,2,location(124.01),2,'LIVE')).toMatchObject({status:'BOARDING_STOP_PASSED',seconds:null}));
 it('rejects destination-before-boarding order',()=>expect(eta.context(stops,0,location(124),'LIVE',3,2).boardingEta.status).toBe('INVALID_STOP_ORDER'));
 it('flags a grossly off-segment position as approximate without rejecting it',()=>expect(eta.calculate(stops,1,{...location(124),latitude:11},2,'LIVE')).toMatchObject({status:'APPROXIMATE',reason:'ROUTE_POSITION_UNCERTAIN'}));
});
