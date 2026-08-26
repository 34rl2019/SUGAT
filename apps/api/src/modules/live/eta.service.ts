import { Injectable } from '@nestjs/common';
@Injectable()
export class EtaService {
  estimate(distanceKm:number,speedMetersSecond?:number|null){const speed=Math.max(speedMetersSecond??0,4);const minutes=distanceKm/(speed*3.6)*60;return{minutes:Math.max(1,Math.round(minutes)),display:minutes<3?'Arriving soon':`~${Math.round(minutes)} min`,confidence:speedMetersSecond?'MEDIUM':'LOW'};}
}
