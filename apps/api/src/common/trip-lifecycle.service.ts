import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, TripStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

export const TRIP_CLOCK = Symbol('TRIP_CLOCK');
export interface TripClock { now(): Date }
export const systemTripClock: TripClock = { now: () => new Date() };
const positivePolicyNumber = (value: string | undefined, fallback: number, minimum: number, maximum: number) => { const parsed = Number(value ?? fallback); return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback; };
export const tripLifecyclePolicy = {
  readyBeforeMinutes: positivePolicyNumber(process.env.TRIP_READY_BEFORE_MINUTES, 60, 5, 240),
  startGraceAfterMinutes: positivePolicyNumber(process.env.TRIP_START_GRACE_AFTER_MINUTES, 30, 5, 180),
  reconcileIntervalSeconds: positivePolicyNumber(process.env.TRIP_LIFECYCLE_RECONCILE_SECONDS, 60, 15, 300),
};
export const MISSED_START_WINDOW = 'MISSED_START_WINDOW';

@Injectable()
export class TripLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripLifecycleService.name);
  private timer?: NodeJS.Timeout;
  constructor(private db: PrismaService, @Inject(TRIP_CLOCK) private clock: TripClock) {}
  now() { return this.clock.now(); }
  timing(departureAt: Date) {
    return {
      readyAt: new Date(departureAt.getTime() - tripLifecyclePolicy.readyBeforeMinutes * 60_000),
      startDeadlineAt: new Date(departureAt.getTime() + tripLifecyclePolicy.startGraceAfterMinutes * 60_000),
    };
  }
  initialStatus(departureAt: Date, now = this.now()): TripStatus {
    return now >= this.timing(departureAt).readyAt ? TripStatus.READY : TripStatus.SCHEDULED;
  }
  async onModuleInit() {
    await this.reconcile().catch(error => this.logger.error(`Initial trip lifecycle reconciliation failed: ${error instanceof Error ? error.message : String(error)}`));
    this.timer = setInterval(() => void this.reconcile().catch(error => this.logger.error(`Trip lifecycle reconciliation failed: ${error instanceof Error ? error.message : String(error)}`)), tripLifecyclePolicy.reconcileIntervalSeconds * 1_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  reconcile(driverId?: string) { return this.reconcileWithRetry(this.now(), driverId); }
  reconcileTrip(tripId: string) { return this.reconcileWithRetry(this.now(), undefined, tripId); }
  private async reconcileWithRetry(now: Date, driverId?: string, tripId?: string) {
    for (let attempt=0;attempt<3;attempt++) { try { return await this.reconcileAt(now,driverId,tripId); } catch(error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code!=='P2034' || attempt===2) throw error; } }
    return { readyIds: [], expiredIds: [] };
  }
  private async reconcileAt(now: Date, driverId?: string, tripId?: string) {
    const readyBefore = new Date(now.getTime() + tripLifecyclePolicy.readyBeforeMinutes * 60_000);
    const overdueBefore = new Date(now.getTime() - tripLifecyclePolicy.startGraceAfterMinutes * 60_000);
    const whereScope = { ...(driverId ? { driverId } : {}), ...(tripId ? { id: tripId } : {}) };
    return this.db.$transaction(async tx => {
      const expired = await tx.trip.findMany({ where: { ...whereScope, status: { in: [TripStatus.SCHEDULED, TripStatus.READY] }, scheduledDepartureAt: { lt: overdueBefore } }, select: { id: true, scheduleId: true } });
      const expiredIds: string[] = [];
      for (const trip of expired) {
        const changed = await tx.trip.updateMany({ where: { id: trip.id, status: { in: [TripStatus.SCHEDULED, TripStatus.READY] }, scheduledDepartureAt: { lt: overdueBefore } }, data: { status: TripStatus.CANCELLED, endedAt: now } });
        if (!changed.count) continue;
        expiredIds.push(trip.id);
        if (trip.scheduleId) await tx.schedule.updateMany({ where: { id: trip.scheduleId, active: true }, data: { active: false } });
        await tx.tripEvent.create({ data: { tripId: trip.id, type: 'CANCELLED', metadata: { reason: MISSED_START_WINDOW, reconciledAt: now.toISOString() } } });
      }
      const scheduled = await tx.trip.findMany({ where: { ...whereScope, status: TripStatus.SCHEDULED, scheduledDepartureAt: { gte: overdueBefore, lte: readyBefore } }, select: { id: true } });
      const readyIds: string[] = [];
      for (const trip of scheduled) {
        const changed = await tx.trip.updateMany({ where: { id: trip.id, status: TripStatus.SCHEDULED, scheduledDepartureAt: { gte: overdueBefore, lte: readyBefore } }, data: { status: TripStatus.READY } });
        if (!changed.count) continue;
        readyIds.push(trip.id);
      }
      return { readyIds, expiredIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
