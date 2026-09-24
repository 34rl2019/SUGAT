import { operatingTrip, startedSegmentEvents } from '../../common/trip-route-stops';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma, Role, TripStatus } from '@prisma/client';
import argon2 from 'argon2';
import { PrismaService } from '../../common/prisma.service';
import { livePolicy, locationFreshness } from '../../common/live-policy';
import { duplicateEmailConflict, isPrismaUniqueConstraintError, normalizeEmail } from '../../common/user-email';
import { DriverComplianceService } from '../../common/driver-compliance.service';
import { TripLifecycleService } from '../../common/trip-lifecycle.service';

const blockingTripStatuses: TripStatus[] = ['READY', 'ACTIVE'];

@Injectable()
export class AdminService {
  constructor(private db: PrismaService, private compliance: DriverComplianceService, private lifecycle: TripLifecycleService) {}
  private audit(actorId: string, action: string, entityType: string, entityId: string) { return this.db.auditLog.create({ data: { actorId, action, entityType, entityId } }); }

  async resetDevice(actorId: string, driverId: string) {
    return this.db.$transaction(async tx => {
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      if (!driver) throw new NotFoundException('Driver not found');
      await tx.driverDevice.deleteMany({ where: { driverId } });
      await tx.refreshSession.updateMany({ where: { userId: driver.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId, action: 'driver.device.reset', entityType: 'Driver', entityId: driverId } });
      return { success: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async dashboard() {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const staleBefore = new Date(Date.now() - livePolicy.staleAfterSeconds * 1_000);
    const now = new Date(), in7Days = new Date(now.getTime() + 7 * 86_400_000), in30Days = new Date(now.getTime() + 30 * 86_400_000);
    const [activeTrips, activeBuses, activeVans, gpsStale, completedToday, licensesExpiringWithin30Days, licensesExpiringWithin7Days, expiredLicenses, driversPendingVerification] = await Promise.all([
      this.db.trip.count({ where: { status: 'ACTIVE' } }),
      this.db.trip.count({ where: { status: 'ACTIVE', vehicle: { type: 'BUS' } } }),
      this.db.trip.count({ where: { status: 'ACTIVE', vehicle: { type: 'VAN' } } }),
      this.db.trip.count({ where: { status: 'ACTIVE', OR: [{ lastLocationAt: null }, { lastLocationAt: { lt: staleBefore } }] } }),
      this.db.trip.count({ where: { status: 'COMPLETED', endedAt: { gte: day } } }),
      this.db.driver.count({ where: { licenseExpiresAt: { gte: now, lte: in30Days } } }),
      this.db.driver.count({ where: { licenseExpiresAt: { gte: now, lte: in7Days } } }),
      this.db.driver.count({ where: { licenseExpiresAt: { lt: now } } }),
      this.db.driver.count({ where: { OR: [{ identityVerificationStatus: { in: ['UNVERIFIED', 'PENDING_VERIFICATION', 'PENDING_REVERIFICATION'] } }, { licenseVerificationStatus: { in: ['UNVERIFIED', 'PENDING_VERIFICATION', 'PENDING_REVERIFICATION'] } }] } }),
    ]);
    return { activeTrips, activeBuses, activeVans, driversOnActiveTrips: activeTrips, gpsStale, completedToday, licensesExpiringWithin30Days, licensesExpiringWithin7Days, expiredLicenses, driversPendingVerification };
  }

  async drivers() { const drivers = await this.db.driver.findMany({ include: { user: { select: { email: true, phone: true, accountStatus: true } }, vehicles: true, authorizedDevice: { select: { authorizedAt: true } } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }); return drivers.map(driver => ({ ...driver, compliance: this.compliance.evaluate(driver) })); }
  async createDriver(actorId: string, dto: any) {
    const { email, password, phone, licenseExpiresAt, ...driver } = dto;
    const normalizedEmail = normalizeEmail(email);
    if (await this.db.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } })) throw duplicateEmailConflict();
    let created;
    try {
      created = await this.db.user.create({ data: { email: normalizedEmail, phone: phone || null, passwordHash: await argon2.hash(password), mustChangePassword: true, role: Role.DRIVER, driver: { create: { ...driver, licenseExpiresAt: licenseExpiresAt ? new Date(licenseExpiresAt) : null } } }, include: { driver: true } });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error, 'email')) throw duplicateEmailConflict();
      if (isPrismaUniqueConstraintError(error)) throw new ConflictException('A user with these account details already exists.');
      throw error;
    }
    await this.audit(actorId, 'driver.created', 'Driver', created.driver!.id); return created.driver;
  }
  async updateDriver(actorId: string, id: string, dto: any) {
    const existingDriver = await this.db.driver.findUnique({ where: { id }, select: { userId: true, licenseNumber: true, licenseExpiresAt: true, identityVerificationStatus: true, licenseVerificationStatus: true } });
    if (!existingDriver) throw new NotFoundException('Driver not found');
    const { email, phone, password, accountStatus, licenseExpiresAt, ...driver } = dto;
    const user: Prisma.UserUpdateInput = {};
    if (email !== undefined) {
      const normalizedEmail = normalizeEmail(email);
      if (await this.db.user.findFirst({ where: { email: normalizedEmail, id: { not: existingDriver.userId } }, select: { id: true } })) throw duplicateEmailConflict();
      user.email = normalizedEmail;
    }
    if (phone !== undefined) user.phone = phone || null;
    if (password) { user.passwordHash = await argon2.hash(password); user.mustChangePassword = true; } if (accountStatus !== undefined) user.accountStatus = accountStatus;
    let updated;
    try {
      const nextExpiry=licenseExpiresAt===undefined?existingDriver.licenseExpiresAt:licenseExpiresAt?new Date(licenseExpiresAt):null;
      const evidenceChanged=(driver.licenseNumber!==undefined&&driver.licenseNumber!==existingDriver.licenseNumber)||(licenseExpiresAt!==undefined&&nextExpiry?.getTime()!==existingDriver.licenseExpiresAt?.getTime());
      const reverify=evidenceChanged&&(existingDriver.identityVerificationStatus==='APPROVED'||existingDriver.licenseVerificationStatus==='APPROVED');
      updated = await this.db.driver.update({ where: { id }, data: { ...driver, ...(licenseExpiresAt !== undefined ? { licenseExpiresAt: nextExpiry } : {}), ...(reverify?{identityVerificationStatus:'PENDING_REVERIFICATION',licenseVerificationStatus:'PENDING_REVERIFICATION'}:{}), ...(Object.keys(user).length ? { user: { update: user } } : {}) }, include: { user: { select: { email: true, phone: true, accountStatus: true } }, vehicles: true } });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error, 'email')) throw duplicateEmailConflict();
      if (isPrismaUniqueConstraintError(error)) throw new ConflictException('A user with these account details already exists.');
      throw error;
    }
    if (password) await this.db.refreshSession.updateMany({ where: { userId: existingDriver.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(actorId, 'driver.updated', 'Driver', id); return updated;
  }
  async driverStatus(actorId: string, id: string, active: boolean) {
    if (!active && await this.db.trip.findFirst({ where: { driverId: id, status: { in: blockingTripStatuses } } })) throw new ConflictException('Cancel or complete the driver’s ready/active trip before deactivation');
    const driver = await this.db.driver.update({ where: { id }, data: { active, user: { update: { accountStatus: active ? AccountStatus.ACTIVE : AccountStatus.DISABLED } } } });
    await this.audit(actorId, 'driver.status.changed', 'Driver', id); return driver;
  }

  vehicles() { return this.db.vehicle.findMany({ include: { assignedDriver: true }, orderBy: { displayName: 'asc' } }); }
  private async validateAssignedDriver(id?: string | null) { if (id && !await this.db.driver.findFirst({ where: { id, active: true, user: { accountStatus: 'ACTIVE' } } })) throw new BadRequestException('Assigned driver must be active'); }
  async createVehicle(actorId: string, dto: any) { await this.validateAssignedDriver(dto.assignedDriverId); const vehicle = await this.db.vehicle.create({ data: { ...dto, assignedDriverId: dto.assignedDriverId || null } }); await this.audit(actorId, 'vehicle.created', 'Vehicle', vehicle.id); return vehicle; }
  async updateVehicle(actorId: string, id: string, dto: any) {
    await this.validateAssignedDriver(dto.assignedDriverId);
    const activeTrip = await this.db.trip.findFirst({ where: { vehicleId: id, status: { in: blockingTripStatuses } } });
    if (activeTrip && activeTrip.driverId !== dto.assignedDriverId) throw new ConflictException('The assigned driver cannot change while this vehicle has a ready/active trip');
    const vehicle = await this.db.vehicle.update({ where: { id }, data: { ...dto, assignedDriverId: dto.assignedDriverId || null }, include: { assignedDriver: true } }); await this.audit(actorId, 'vehicle.updated', 'Vehicle', id); return vehicle;
  }
  async vehicleStatus(actorId: string, id: string, active: boolean) { if (!active && await this.db.trip.findFirst({ where: { vehicleId: id, status: { in: blockingTripStatuses } } })) throw new ConflictException('Cancel or complete the vehicle’s ready/active trip before deactivation'); const vehicle = await this.db.vehicle.update({ where: { id }, data: { active } }); await this.audit(actorId, 'vehicle.status.changed', 'Vehicle', id); return vehicle; }

  stops() { return this.db.stop.findMany({ orderBy: { name: 'asc' } }); }
  async createStop(actorId: string, dto: any) { const stop = await this.db.stop.create({ data: dto }); await this.audit(actorId, 'stop.created', 'Stop', stop.id); return stop; }
  async updateStop(actorId: string, id: string, dto: any) { const stop = await this.db.stop.update({ where: { id }, data: dto }); await this.audit(actorId, 'stop.updated', 'Stop', id); return stop; }
  async stopStatus(actorId: string, id: string, active: boolean) { if (!active && await this.db.routeStop.findFirst({ where: { stopId: id, route: { active: true } } })) throw new ConflictException('Deactivate routes using this stop before deactivating it'); const stop = await this.db.stop.update({ where: { id }, data: { active } }); await this.audit(actorId, 'stop.status.changed', 'Stop', id); return stop; }

  routes() { return this.db.route.findMany({ include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } }, orderBy: { name: 'asc' } }); }
  private async validateRouteStops(stops: any[]) {
    if (stops.length < 2) throw new BadRequestException('A route needs at least two stops');
    const sequences = stops.map(stop => stop.sequence), ids = stops.map(stop => stop.stopId);
    if (new Set(sequences).size !== sequences.length || new Set(ids).size !== ids.length) throw new BadRequestException('Stop and sequence values must be unique');
    if (!sequences.every((sequence, index) => sequence === index + 1)) throw new BadRequestException('Route sequences must be contiguous and start at 1');
    if (await this.db.stop.count({ where: { id: { in: ids }, active: true } }) !== ids.length) throw new BadRequestException('All stops must exist and be active');
  }
  async createRoute(actorId: string, dto: any) { await this.validateRouteStops(dto.stops); const route = await this.db.route.create({ data: { name: dto.name, direction: dto.direction, stops: { create: dto.stops } }, include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } } }); await this.audit(actorId, 'route.created', 'Route', route.id); return route; }
  async updateRoute(actorId: string, id: string, dto: any) {
    await this.validateRouteStops(dto.stops); if (await this.db.trip.findFirst({ where: { routeId: id, status: { in: blockingTripStatuses } } })) throw new ConflictException('Cancel or complete ready/active trips before changing this route');
    const route = await this.db.$transaction(async transaction => { await transaction.routeStop.deleteMany({ where: { routeId: id } }); return transaction.route.update({ where: { id }, data: { name: dto.name, direction: dto.direction, stops: { create: dto.stops } }, include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } } }); });
    await this.audit(actorId, 'route.updated', 'Route', id); return route;
  }
  async routeStatus(actorId: string, id: string, active: boolean) { if (!active && await this.db.trip.findFirst({ where: { routeId: id, status: { in: blockingTripStatuses } } })) throw new ConflictException('Cancel or complete ready/active trips before deactivating this route'); const route = await this.db.route.update({ where: { id }, data: { active } }); await this.audit(actorId, 'route.status.changed', 'Route', id); return route; }

  async schedules() { await this.lifecycle.reconcile(); return this.db.schedule.findMany({ include: { route: true, driver: true, vehicle: true, trip: true }, orderBy: { departureAt: 'desc' }, take: 250 }); }
  async cancelSchedule(actorId: string, id: string) {
    const schedule = await this.db.schedule.findUnique({ where: { id }, include: { trip: true } }); if (!schedule) throw new NotFoundException('Schedule not found');
    if (!schedule.active || !schedule.trip || !['SCHEDULED', 'READY'].includes(schedule.trip.status)) throw new ConflictException('Only an active unstarted schedule can be cancelled');
    const now=this.lifecycle.now();
    try {
      const cancelled = await this.db.$transaction(async transaction => { const changed=await transaction.trip.updateMany({where:{id:schedule.trip!.id,status:{in:['SCHEDULED','READY']}},data:{status:'CANCELLED',endedAt:now}});if(changed.count!==1)throw new ConflictException('Only an active unstarted schedule can be cancelled');await transaction.tripEvent.create({data:{tripId:schedule.trip!.id,type:'CANCELLED',metadata:{reason:'ADMIN_CANCELLED'}}});return transaction.schedule.update({ where: { id, active:true }, data: { active: false }, include: { trip: true, route: true, driver: true, vehicle: true } }); },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      await this.audit(actorId, 'schedule.cancelled', 'Schedule', id); return cancelled;
    } catch(error) { if(error instanceof ConflictException)throw error;if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2034')throw new ConflictException('Trip state changed while cancellation was processing');throw error; }
  }

  async live() {
    const trips = await this.db.trip.findMany({ where: { status: 'ACTIVE' }, include: { events: startedSegmentEvents, currentLocation: true, vehicle: true, driver: { include: { user: { select: { id: true, email: true, phone: true, role: true, accountStatus: true } } } }, route: { include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } } } }, orderBy: { startedAt: 'desc' } });
    return trips.map(operatingTrip).map(trip => { const compliance = this.compliance.evaluate(trip.driver); return { ...trip, complianceAlert: compliance.eligible ? null : compliance, gpsStatus: trip.currentLocation ? locationFreshness(trip.currentLocation.recordedAt) : 'OFFLINE', nextStop: trip.route.stops.find(stop => stop.sequence > trip.lastPassedSequence)?.stop ?? null }; });
  }
}
