import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccountStatus, Role, VehicleType } from '@prisma/client';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AuthUser, CurrentUser, JwtGuard, Roles } from '../../common/auth';
import { AdminService } from './admin.service';

class DriverDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() email!: string; @MinLength(12) @MaxLength(128) password!: string;
  @IsString() firstName!: string; @IsOptional() @IsString() middleName?: string; @IsString() lastName!: string;
  @IsOptional() @IsString() phone?: string; @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() licenseNumber?: string; @IsOptional() @IsDateString() licenseExpiresAt?: string;
}
class UpdateDriverDto {
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() email?: string; @IsOptional() @MinLength(12) @MaxLength(128) password?: string;
  @IsOptional() @IsString() firstName?: string; @IsOptional() @IsString() middleName?: string; @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string; @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() licenseNumber?: string; @IsOptional() @IsDateString() licenseExpiresAt?: string;
  @IsOptional() @IsEnum(AccountStatus) accountStatus?: AccountStatus;
}
class VehicleDto {
  @IsOptional() @IsString() @MaxLength(100) conductionSticker?: string;
  @IsEnum(VehicleType) type!: VehicleType; @IsString() plateNumber!: string; @IsString() displayName!: string;
  @IsOptional() @IsString() bodyNumber?: string; @IsOptional() @IsString() brand?: string; @IsOptional() @IsString() model?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsUUID() assignedDriverId?: string | null;
}
class StopDto {
  @IsString() name!: string; @IsNumber() @Min(-90) @Max(90) latitude!: number; @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsString() description?: string; @IsOptional() @IsString() cityMunicipality?: string; @IsOptional() @IsString() province?: string;
}
class RouteStopDto {
  @IsUUID() stopId!: string; @IsInt() @Min(1) sequence!: number;
  @IsOptional() @IsBoolean() boardingAllowed?: boolean; @IsOptional() @IsBoolean() dropoffAllowed?: boolean;
  @IsOptional() @IsInt() @Min(0) minutesFromPrevious?: number;
}
class RouteDto { @IsString() name!: string; @IsString() direction!: string; @IsArray() @ValidateNested({ each: true }) @Type(() => RouteStopDto) stops!: RouteStopDto[]; }
class ActiveDto { @IsBoolean() active!: boolean; }

@UseGuards(JwtGuard) @Roles(Role.ADMIN) @Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}
  @Get('dashboard') dashboard() { return this.admin.dashboard(); }
  @Get('drivers') drivers() { return this.admin.drivers(); }
  @Post('drivers/:id/device/reset') resetDevice(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.admin.resetDevice(u.sub, id); }
  @Post('drivers') createDriver(@CurrentUser() u: AuthUser, @Body() d: DriverDto) { return this.admin.createDriver(u.sub, d); }
  @Patch('drivers/:id') updateDriver(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: UpdateDriverDto) { return this.admin.updateDriver(u.sub, id, d); }
  @Patch('drivers/:id/status') driverStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ActiveDto) { return this.admin.driverStatus(u.sub, id, d.active); }
  @Get('vehicles') vehicles() { return this.admin.vehicles(); }
  @Post('vehicles') createVehicle(@CurrentUser() u: AuthUser, @Body() d: VehicleDto) { return this.admin.createVehicle(u.sub, d); }
  @Patch('vehicles/:id') updateVehicle(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: VehicleDto) { return this.admin.updateVehicle(u.sub, id, d); }
  @Patch('vehicles/:id/status') vehicleStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ActiveDto) { return this.admin.vehicleStatus(u.sub, id, d.active); }
  @Get('stops') stops() { return this.admin.stops(); }
  @Post('stops') createStop(@CurrentUser() u: AuthUser, @Body() d: StopDto) { return this.admin.createStop(u.sub, d); }
  @Patch('stops/:id') updateStop(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: StopDto) { return this.admin.updateStop(u.sub, id, d); }
  @Patch('stops/:id/status') stopStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ActiveDto) { return this.admin.stopStatus(u.sub, id, d.active); }
  @Get('routes') routes() { return this.admin.routes(); }
  @Post('routes') createRoute(@CurrentUser() u: AuthUser, @Body() d: RouteDto) { return this.admin.createRoute(u.sub, d); }
  @Patch('routes/:id') updateRoute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: RouteDto) { return this.admin.updateRoute(u.sub, id, d); }
  @Patch('routes/:id/status') routeStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ActiveDto) { return this.admin.routeStatus(u.sub, id, d.active); }
  @Get('schedules') schedules() { return this.admin.schedules(); }
  @Post('schedules/:id/cancel') cancelSchedule(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.admin.cancelSchedule(u.sub, id); }
  @Get('live') live() { return this.admin.live(); }
}
