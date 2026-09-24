import { Injectable } from '@nestjs/common';
import type { Freshness } from '../../common/live-policy';

type Point={latitude:number;longitude:number};
export type EtaRouteStop={sequence:number;minutesFromPrevious:number|null;stop:Point&{id:string;name:string}};
export type EtaLocation=Point&{speed?:number|null;recordedAt:Date};
export type EtaStatus='AVAILABLE'|'APPROXIMATE'|'UNAVAILABLE'|'BOARDING_STOP_PASSED'|'INVALID_STOP_ORDER';
export type EtaResult={seconds:number|null;minutes:number|null;display:string;status:EtaStatus;reason:string|null};
const unavailable=(status:EtaStatus,reason:string,display='ETA unavailable'):EtaResult=>({seconds:null,minutes:null,display,status,reason});
const distanceMeters=(a:Point,b:Point)=>{const r=6371e3,p=(x:number)=>x*Math.PI/180,dlat=p(b.latitude-a.latitude),dlng=p(b.longitude-a.longitude),v=Math.sin(dlat/2)**2+Math.cos(p(a.latitude))*Math.cos(p(b.latitude))*Math.sin(dlng/2)**2;return 2*r*Math.asin(Math.sqrt(v));};
const segmentProgress=(a:Point,b:Point,p:Point)=>{const scale=Math.cos((a.latitude+b.latitude)*Math.PI/360),ax=a.longitude*scale,ay=a.latitude,bx=b.longitude*scale,by=b.latitude,px=p.longitude*scale,py=p.latitude,dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;if(!length)return 0;return Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/length));};

@Injectable()
export class EtaService {
  private readonly fallbackSpeedMetersSecond=(()=>{const configured=Number(process.env.ETA_FALLBACK_SPEED_KPH??40);return(Number.isFinite(configured)&&configured>=5&&configured<=120?configured:40)/3.6;})();
  private segmentSeconds(previous:EtaRouteStop|undefined,next:EtaRouteStop){if(next.minutesFromPrevious!=null&&next.minutesFromPrevious>0)return next.minutesFromPrevious*60;if(previous)return distanceMeters(previous.stop,next.stop)/this.fallbackSpeedMetersSecond;return 0;}
  calculate(stops:EtaRouteStop[],lastPassedSequence:number,location:EtaLocation|null,targetSequence:number,freshness:Freshness):EtaResult{
    const target=stops.find(stop=>stop.sequence===targetSequence);if(!target)return unavailable('INVALID_STOP_ORDER','STOP_NOT_ON_ROUTE');
    if(targetSequence<=lastPassedSequence)return unavailable('BOARDING_STOP_PASSED','STOP_ALREADY_PASSED','Boarding stop passed');
    if(!location)return unavailable('UNAVAILABLE','NO_CURRENT_LOCATION','Waiting for live location');
    if(freshness==='OFFLINE')return unavailable('UNAVAILABLE','LOCATION_OFFLINE');
    if(distanceMeters(location,target.stop)<=150)return{seconds:0,minutes:0,display:'Arriving now',status:freshness==='LIVE'?'AVAILABLE':'APPROXIMATE',reason:freshness==='LIVE'?null:'LOCATION_STALE'};
    let nextIndex=stops.findIndex(stop=>stop.sequence>lastPassedSequence);

    // Route progression is authoritative for boarding eligibility.
    // GPS distance alone must never mark the first stop as passed.
    //
    // For ETA to a later stop, however, a vehicle that has already moved
    // beyond the first stop radius may use the first outbound segment for
    // ETA interpolation. This affects ETA calculation only and does not
    // change whether the first stop is still a valid boarding stop.
    if(
      nextIndex===0 &&
      stops.length>1 &&
      targetSequence>stops[0].sequence &&
      distanceMeters(location,stops[0].stop)>150
    ) nextIndex=1;

    if(nextIndex<0||targetSequence<stops[nextIndex].sequence)return unavailable('BOARDING_STOP_PASSED','STOP_ALREADY_PASSED','Boarding stop passed');
    const previous=nextIndex>0?stops[nextIndex-1]:undefined,next=stops[nextIndex];let seconds=0,deviation=false,speedConcern:string|null=null;
    if(previous){const progress=segmentProgress(previous.stop,next.stop,location),expected=this.segmentSeconds(previous,next),remainingDistance=distanceMeters(location,next.stop);let current=expected*(1-progress);const speed=location.speed;if(speed!=null&&Number.isFinite(speed)&&speed>=1&&speed<=55)current=current*.7+(remainingDistance/speed)*.3;else if(speed!=null)speedConcern=Number.isFinite(speed)&&speed>=0&&speed<1?'VEHICLE_STOPPED':'SPEED_UNRELIABLE';seconds+=current;deviation=Math.min(distanceMeters(location,previous.stop),remainingDistance)>10_000;}else{seconds+=distanceMeters(location,next.stop)/this.fallbackSpeedMetersSecond;}
    for(let index=nextIndex+1;index<stops.length&&stops[index].sequence<=targetSequence;index++)seconds+=this.segmentSeconds(stops[index-1],stops[index]);
    const roundedSeconds=Math.max(0,Math.round(seconds)),minutes=Math.ceil(roundedSeconds/60),approximate=freshness==='STALE'||deviation||Boolean(speedConcern);
    return{seconds:roundedSeconds,minutes,display:minutes<=2?'Arriving soon':`~${minutes} min`,status:approximate?'APPROXIMATE':'AVAILABLE',reason:freshness==='STALE'?'LOCATION_STALE':deviation?'ROUTE_POSITION_UNCERTAIN':speedConcern};
  }
  context(stops:EtaRouteStop[],lastPassedSequence:number,location:EtaLocation|null,freshness:Freshness,boardingSequence:number,destinationSequence:number){
    if(boardingSequence>=destinationSequence)return{boardingEta:unavailable('INVALID_STOP_ORDER','DESTINATION_NOT_AFTER_BOARDING'),destinationEta:unavailable('INVALID_STOP_ORDER','DESTINATION_NOT_AFTER_BOARDING'),remainingTripTime:unavailable('INVALID_STOP_ORDER','DESTINATION_NOT_AFTER_BOARDING')};
    return{boardingEta:this.calculate(stops,lastPassedSequence,location,boardingSequence,freshness),destinationEta:this.calculate(stops,lastPassedSequence,location,destinationSequence,freshness),remainingTripTime:this.calculate(stops,lastPassedSequence,location,stops.at(-1)?.sequence??destinationSequence,freshness)};
  }
}
