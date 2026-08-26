import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role, VehicleType } from '@prisma/client';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser, JwtGuard, Roles } from '../../common/auth';
import { AdminService } from './admin.service';
class DriverDto { @IsEmail() email!:string; @MinLength(10) password!:string; @IsString() firstName!:string; @IsString() lastName!:string; @IsOptional() @IsString() phone?:string }
class VehicleDto { @IsEnum(VehicleType) type!:VehicleType; @IsString() plateNumber!:string; @IsString() displayName!:string; @IsOptional() @IsUUID() assignedDriverId?:string }
class StopDto { @IsString() name!:string; @IsNumber() @Min(-90) @Max(90) latitude!:number; @IsNumber() @Min(-180) @Max(180) longitude!:number; @IsOptional() @IsString() cityMunicipality?:string; @IsOptional() @IsString() province?:string }
class RouteStopDto { @IsUUID() stopId!:string; @IsInt() @Min(1) sequence!:number; @IsOptional() @IsBoolean() boardingAllowed?:boolean; @IsOptional() @IsBoolean() dropoffAllowed?:boolean; @IsOptional() @IsInt() @Min(0) minutesFromPrevious?:number }
class RouteDto { @IsString() name!:string; @IsString() direction!:string; @IsArray() @ValidateNested({each:true}) @Type(()=>RouteStopDto) stops!:RouteStopDto[] }
class ScheduleDto { @IsUUID() routeId!:string; @IsUUID() driverId!:string; @IsUUID() vehicleId!:string; @IsDateString() departureAt!:string }
class ActiveDto { @IsBoolean() active!:boolean }
@UseGuards(JwtGuard) @Roles(Role.ADMIN) @Controller('admin')
export class AdminController {
 constructor(private admin:AdminService){}
 @Get('dashboard') dashboard(){return this.admin.dashboard();}
 @Get('drivers') drivers(){return this.admin.drivers();}
 @Post('drivers') createDriver(@CurrentUser() u:AuthUser,@Body() d:DriverDto){return this.admin.createDriver(u.sub,d);}
 @Patch('drivers/:id/status') driverStatus(@CurrentUser()u:AuthUser,@Param('id')id:string,@Body()d:ActiveDto){return this.admin.driverStatus(u.sub,id,d.active);}
 @Get('vehicles') vehicles(){return this.admin.vehicles();}
 @Post('vehicles') createVehicle(@CurrentUser()u:AuthUser,@Body()d:VehicleDto){return this.admin.createVehicle(u.sub,d);}
 @Get('stops') stops(){return this.admin.stops();}
 @Post('stops') createStop(@CurrentUser()u:AuthUser,@Body()d:StopDto){return this.admin.createStop(u.sub,d);}
 @Get('routes') routes(){return this.admin.routes();}
 @Post('routes') createRoute(@CurrentUser()u:AuthUser,@Body()d:RouteDto){return this.admin.createRoute(u.sub,d);}
 @Post('schedules') schedule(@CurrentUser()u:AuthUser,@Body()d:ScheduleDto){return this.admin.createSchedule(u.sub,d);}
 @Get('live') live(){return this.admin.live();}
}
