import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { DUPLICATE_EMAIL_MESSAGE } from '../../common/user-email';
import { DriverComplianceService } from '../../common/driver-compliance.service';

describe('AdminService management workflows', () => {
  function service(overrides: Record<string, any> = {}) {
    const db: any = {
      user: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      stop: { count: jest.fn().mockResolvedValue(2) },
      route: { create: jest.fn().mockResolvedValue({ id: 'route-1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      schedule: { findUnique: jest.fn(), update: jest.fn() },
      trip: { update: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(db)),
      ...overrides,
    };
    return { db, admin: new AdminService(db, new DriverComplianceService()) };
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

  describe('driver account email uniqueness', () => {
    const driver = (email: string) => ({ email, password: 'LongEnoughPassword!', firstName: 'Juan', lastName: 'Dela Cruz' });
    const expectDuplicate = async (promise: Promise<unknown>) => {
      try {
        await promise;
        throw new Error('Expected duplicate email conflict');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect((error as ConflictException).message).toBe(DUPLICATE_EMAIL_MESSAGE);
      }
    };

    it('creates a driver account with a new unique normalized email', async () => {
      const { admin, db } = service();
      db.user.create.mockResolvedValue({ driver: { id: 'driver-1' } });

      await expect(admin.createDriver('admin-1', driver('  New.Driver@Example.COM '))).resolves.toEqual({ id: 'driver-1' });
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'new.driver@example.com' }, select: { id: true } });
      expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'new.driver@example.com' }) }));
    });

    it('rejects the same email before attempting creation', async () => {
      const { admin, db } = service();
      db.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expectDuplicate(admin.createDriver('admin-1', driver('driver@example.com')));
      expect(db.user.create).not.toHaveBeenCalled();
    });

    it('rejects the same email with different casing', async () => {
      const { admin, db } = service();
      db.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.email === 'driver@example.com' ? { id: 'existing-user' } : null));

      await expectDuplicate(admin.createDriver('admin-1', driver('DRIVER@EXAMPLE.COM')));
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'driver@example.com' }, select: { id: true } });
    });

    it('rejects a whitespace-normalized duplicate email', async () => {
      const { admin, db } = service();
      db.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.email === 'driver@example.com' ? { id: 'existing-user' } : null));

      await expectDuplicate(admin.createDriver('admin-1', driver('  driver@example.com\t')));
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'driver@example.com' }, select: { id: true } });
    });

    it('converts a concurrent Prisma P2002 collision into a controlled 409', async () => {
      const { admin, db } = service();
      db.user.create.mockRejectedValue(Object.assign(new Error('database details must not escape'), { code: 'P2002', meta: { target: ['email'] } }));

      await expectDuplicate(admin.createDriver('admin-1', driver('race@example.com')));
    });
  });

  it('forces approved drivers into re-verification when license evidence changes', async () => {
    const existing={userId:'user-1',licenseNumber:'OLD-1',licenseExpiresAt:new Date('2027-01-01'),identityVerificationStatus:'APPROVED',licenseVerificationStatus:'APPROVED'};
    const driverModel={findUnique:jest.fn().mockResolvedValue(existing),update:jest.fn().mockResolvedValue({id:'driver-1'})};
    const {admin}=service({driver:driverModel});
    await admin.updateDriver('admin-1','driver-1',{licenseNumber:'NEW-2'});
    expect(driverModel.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({identityVerificationStatus:'PENDING_REVERIFICATION',licenseVerificationStatus:'PENDING_REVERIFICATION'})}));
  });
});
