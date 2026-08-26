import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { LiveService } from './live.service';
class SearchQuery { @IsUUID() fromStopId!:string; @IsUUID() toStopId!:string }
@Controller('public')
export class LiveController {
 constructor(private live:LiveService){}
 @Get('stops') stops(){return this.live.stops();}
 @Get('routes') routes(){return this.live.routes();}
 @Get('trips/search') search(@Query() q:SearchQuery){return this.live.search(q.fromStopId,q.toStopId);}
 @Get('trips/:id') trip(@Param('id')id:string){return this.live.getTrip(id);}
 @Get('trips/:id/location') location(@Param('id')id:string){return this.live.getLocation(id);}
}
