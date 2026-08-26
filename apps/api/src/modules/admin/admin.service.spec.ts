import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService management workflows', () => {
  function service(overrides: Record<string, any> = {}) {
    const db: any = {
      stop: { count: jest.fn().mockResolvedValue(2) },
      route: { create: jest.fn().mockResolvedValue({ id: 'route-1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      schedule: { findUnique: jest.fn(), update: jest.fn() },
      trip: { update: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(db)),
      ...overrides,
    };
    return { db, admin: new AdminService(db) };
  }

  it('creates a route only with contiguous unique ordered stops', async () => {
    const { admin, db } = service();
    await admin.createRoute('admin-1', {
      name: 'Tacloban to Sogod', direction: 'SOUTHBOUND',
      stops: [{ stopId: 'stop-1', sequence: 1 }, { stopId: 'stop-2', sequence: 2 }],
    });
    expect(db.route.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stops: { create: expect.any(Array) } }) }));
  });

  it('rejects duplicate route stops before writing', async () => {
    const { admin } = service();
    await expect(admin.createRoute('admin-1', {
      name: 'Invalid', direction: 'SOUTHBOUND',
      stops: [{ stopId: 'stop-1', sequence: 1 }, { stopId: 'stop-1', sequence: 2 }],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels an unstarted schedule and its generated trip together', async () => {
    const { admin, db } = service();
    db.schedule.findUnique.mockResolvedValue({ id: 'schedule-1', active: true, trip: { id: 'trip-1', status: 'READY' } });
    db.schedule.update.mockResolvedValue({ id: 'schedule-1', active: false });
    await admin.cancelSchedule('admin-1', 'schedule-1');
    expect(db.trip.update).toHaveBeenCalledWith({ where: { id: 'trip-1' }, data: expect.objectContaining({ status: 'CANCELLED' }) });
    expect(db.schedule.update).toHaveBeenCalledWith(expect.objectContaining({ data: { active: false } }));
  });

  it('does not cancel a trip that has already started', async () => {
    const { admin, db } = service();
    db.schedule.findUnique.mockResolvedValue({ id: 'schedule-1', active: true, trip: { id: 'trip-1', status: 'ACTIVE' } });
    await expect(admin.cancelSchedule('admin-1', 'schedule-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
