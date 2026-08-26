import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma, Role, TripStatus } from '@prisma/client';
import argon2 from 'argon2';
import { PrismaService } from '../../common/prisma.service';
import { livePolicy, locationFreshness } from '../../common/live-policy';

const blockingTripStatuses: TripStatus[] = ['READY', 'ACTIVE'];

@Injectable()
export class AdminService {
  constructor(private db: PrismaService) {}
  private audit(actorId: string, action: string, entityType: string, entityId: string) { return this.db.auditLog.create({ data: { actorId, action, entityType, entityId } }); }

  async dashboard() {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const staleBefore = new Date(Date.now() - livePolicy.staleAfterSeconds * 1_000);
    const [activeTrips, activeBuses, activeVans, gpsStale, completedToday] = await Promise.all([
      this.db.trip.count({ where: { status: 'ACTIVE' } }),
      this.db.trip.count({ where: { status: 'ACTIVE', vehicle: { type: 'BUS' } } }),
      this.db.trip.count({ where: { status: 'ACTIVE', vehicle: { type: 'VAN' } } }),
      this.db.trip.count({ where: { status: 'ACTIVE', OR: [{ lastLocationAt: null }, { lastLocationAt: { lt: staleBefore } }] } }),
      this.db.trip.count({ where: { status: 'COMPLETED', endedAt: { gte: day } } }),
    ]);
    return { activeTrips, activeBuses, activeVans, driversOnActiveTrips: activeTrips, gpsStale, completedToday };
  }

  drivers() { return this.db.driver.findMany({ include: { user: { select: { email: true, phone: true, accountStatus: true } }, vehicles: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }); }
  async createDriver(actorId: string, dto: any) {
    const { email, password, phone, licenseExpiresAt, ...driver } = dto;
    const created = await this.db.user.create({ data: { email: email.toLowerCase(), phone: phone || null, passwordHash: await argon2.hash(password), role: Role.DRIVER, driver: { create: { ...driver, licenseExpiresAt: licenseExpiresAt ? new Date(licenseExpiresAt) : null } } }, include: { driver: true } });
    await this.audit(actorId, 'driver.created', 'Driver', created.driver!.id); return created.driver;
  }
  async updateDriver(actorId: string, id: string, dto: any) {
    if (!await this.db.driver.findUnique({ where: { id } })) throw new NotFoundException('Driver not found');
    const { email, phone, password, accountStatus, licenseExpiresAt, ...driver } = dto;
    const user: Prisma.UserUpdateInput = {};
    if (email !== undefined) user.email = email.toLowerCase(); if (phone !== undefined) user.phone = phone || null;
    if (password) user.passwordHash = await argon2.hash(password); if (accountStatus !== undefined) user.accountStatus = accountStatus;
    const updated = await this.db.driver.update({ where: { id }, data: { ...driver, ...(licenseExpiresAt !== undefined ? { licenseExpiresAt: licenseExpiresAt ? new Date(licenseExpiresAt) : null } : {}), ...(Object.keys(user).length ? { user: { update: user } } : {}) }, include: { user: { select: { email: true, phone: true, accountStatus: true } }, vehicles: true } });
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

  schedules() { return this.db.schedule.findMany({ include: { route: true, driver: true, vehicle: true, trip: true }, orderBy: { departureAt: 'desc' }, take: 250 }); }
  async createSchedule(actorId: string, dto: any) {
    const departureAt = new Date(dto.departureAt); if (Number.isNaN(departureAt.getTime())) throw new BadRequestException('Invalid departure date');
    const from = new Date(departureAt.getTime() - 4 * 3_600_000), to = new Date(departureAt.getTime() + 4 * 3_600_000);
    const [route, driver, vehicle, conflict] = await Promise.all([
      this.db.route.findFirst({ where: { id: dto.routeId, active: true } }), this.db.driver.findFirst({ where: { id: dto.driverId, active: true, user: { accountStatus: 'ACTIVE' } } }),
      this.db.vehicle.findFirst({ where: { id: dto.vehicleId, active: true, assignedDriverId: dto.driverId } }), this.db.schedule.findFirst({ where: { active: true, departureAt: { gte: from, lte: to }, OR: [{ driverId: dto.driverId }, { vehicleId: dto.vehicleId }] } }),
    ]);
    if (!route) throw new BadRequestException('An active route is required'); if (!driver) throw new BadRequestException('An active driver is required'); if (!vehicle) throw new BadRequestException('Select an active vehicle assigned to this driver'); if (conflict) throw new ConflictException('Driver or vehicle has an overlapping assignment within four hours');
    const schedule = await this.db.schedule.create({ data: { ...dto, departureAt, trip: { create: { routeId: dto.routeId, driverId: dto.driverId, vehicleId: dto.vehicleId, scheduledDepartureAt: departureAt, status: 'READY' } } }, include: { trip: true } }); await this.audit(actorId, 'schedule.created', 'Schedule', schedule.id); return schedule;
  }
  async cancelSchedule(actorId: string, id: string) {
    const schedule = await this.db.schedule.findUnique({ where: { id }, include: { trip: true } }); if (!schedule) throw new NotFoundException('Schedule not found');
    if (!schedule.active || !schedule.trip || !['SCHEDULED', 'READY'].includes(schedule.trip.status)) throw new ConflictException('Only an active unstarted schedule can be cancelled');
    const cancelled = await this.db.$transaction(async transaction => { await transaction.trip.update({ where: { id: schedule.trip!.id }, data: { status: 'CANCELLED', endedAt: new Date() } }); return transaction.schedule.update({ where: { id }, data: { active: false }, include: { trip: true, route: true, driver: true, vehicle: true } }); }); await this.audit(actorId, 'schedule.cancelled', 'Schedule', id); return cancelled;
  }

  async live() {
    const trips = await this.db.trip.findMany({ where: { status: 'ACTIVE' }, include: { currentLocation: true, vehicle: true, driver: true, route: { include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } } } }, orderBy: { startedAt: 'desc' } });
    return trips.map(trip => ({ ...trip, gpsStatus: trip.currentLocation ? locationFreshness(trip.currentLocation.recordedAt) : 'OFFLINE', nextStop: trip.route.stops.find(stop => stop.sequence > trip.lastPassedSequence)?.stop ?? null }));
  }
}
