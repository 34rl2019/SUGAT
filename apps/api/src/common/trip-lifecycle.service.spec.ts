import { TripStatus } from '@prisma/client';
import { MISSED_START_WINDOW, TripLifecycleService, tripLifecyclePolicy } from './trip-lifecycle.service';

describe('TripLifecycleService', () => {
  const now = new Date('2026-09-05T00:00:00.000Z');
  const service = (db: any = {}) => new TripLifecycleService(db, { now: () => new Date(now) });

  it('uses deterministic readiness and grace boundaries', () => {
    const lifecycle = service();
    const departure = new Date(now.getTime() + tripLifecyclePolicy.readyBeforeMinutes * 60_000);
    expect(lifecycle.initialStatus(new Date(departure.getTime() + 1), now)).toBe(TripStatus.SCHEDULED);
    expect(lifecycle.initialStatus(departure, now)).toBe(TripStatus.READY);
    expect(lifecycle.timing(new Date('2026-09-05T00:00:00.000Z')).startDeadlineAt.toISOString()).toBe('2026-09-05T00:30:00.000Z');
  });

  it('materializes readiness once across concurrent and repeated reconciliation', async () => {
    let status: string = 'SCHEDULED', transitions = 0;
    const tx: any = { trip: { findMany: jest.fn(async ({ where }: any) => { return where.status === TripStatus.SCHEDULED && status === 'SCHEDULED' ? [{ id: 'trip-1' }] : []; }), updateMany: jest.fn(async () => { if (status !== 'SCHEDULED') return { count: 0 }; status = 'READY'; transitions++; return { count: 1 }; }) }, schedule: { updateMany: jest.fn() }, tripEvent: { create: jest.fn() } };
    const lifecycle = service({ $transaction: (callback: any) => callback(tx) });
    await Promise.all([lifecycle.reconcile(), lifecycle.reconcile()]); await lifecycle.reconcile();
    expect(status).toBe('READY'); expect(transitions).toBe(1); expect(tx.tripEvent.create).not.toHaveBeenCalled();
  });

  it('retires an overdue unstarted trip once with a machine reason', async () => {
    let status: string = 'READY';
    const tx: any = { trip: { findMany: jest.fn(async ({ where }: any) => { return Array.isArray(where.status?.in) && status === 'READY' ? [{ id: 'trip-1', scheduleId: 'schedule-1' }] : []; }), updateMany: jest.fn(async () => { if (status !== 'READY') return { count: 0 }; status = 'CANCELLED'; return { count: 1 }; }) }, schedule: { updateMany: jest.fn() }, tripEvent: { create: jest.fn() } };
    const lifecycle = service({ $transaction: (callback: any) => callback(tx) });
    await lifecycle.reconcile(); await lifecycle.reconcile();
    expect(status).toBe('CANCELLED'); expect(tx.schedule.updateMany).toHaveBeenCalledTimes(1); expect(tx.tripEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'CANCELLED', metadata: expect.objectContaining({ reason: MISSED_START_WINDOW }) }) });
  });
});
