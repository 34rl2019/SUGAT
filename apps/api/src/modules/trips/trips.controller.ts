import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser, JwtGuard, Roles } from '../../common/auth';
import { TripsService } from './trips.service';
class LocationDto { @IsString() eventId!:string; @IsNumber() @Min(-90) @Max(90) latitude!:number; @IsNumber() @Min(-180) @Max(180) longitude!:number; @IsNumber() @Min(0) @Max(5000) accuracy!:number; @IsOptional() @IsNumber() @Min(0) @Max(250) speed?:number; @IsOptional() @IsNumber() @Min(0) @Max(360) heading?:number; @IsDateString() recordedAt!:string }
class BatchDto { @IsArray() @ValidateNested({each:true}) @Type(()=>LocationDto) events!:LocationDto[] }
@UseGuards(JwtGuard) @Roles(Role.DRIVER) @Controller('driver')
export class TripsController {
 constructor(private trips:TripsService){}
 @Get('assignment') assignment(@CurrentUser()u:AuthUser){return this.trips.assignment(u.sub);}
 @Post('trips/:id/start') start(@CurrentUser()u:AuthUser,@Param('id')id:string){return this.trips.start(u.sub,id);}
 @Post('trips/:id/locations') location(@CurrentUser()u:AuthUser,@Param('id')id:string,@Body()d:LocationDto){return this.trips.ingest(u.sub,id,d);}
 @Post('trips/:id/locations/batch') batch(@CurrentUser()u:AuthUser,@Param('id')id:string,@Body()d:BatchDto){return this.trips.ingestBatch(u.sub,id,d.events);}
 @Post('trips/:id/complete') complete(@CurrentUser()u:AuthUser,@Param('id')id:string){return this.trips.complete(u.sub,id);}
}
