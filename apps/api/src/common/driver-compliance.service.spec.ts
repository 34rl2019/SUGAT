import { ForbiddenException } from '@nestjs/common';
import { AccountStatus, VerificationStatus } from '@prisma/client';
import { DriverComplianceService } from './driver-compliance.service';

describe('DriverComplianceService', () => {
  const now = new Date('2026-08-27T00:00:00.000Z');
  const service = new DriverComplianceService();
  const valid = (overrides: Record<string, unknown> = {}) => ({
    active: true,
    licenseNumber: 'N01-23-456789',
    licenseExpiresAt: new Date('2027-08-27T00:00:00.000Z'),
    identityVerificationStatus: VerificationStatus.APPROVED,
    licenseVerificationStatus: VerificationStatus.APPROVED,
    user: { accountStatus: AccountStatus.ACTIVE },
    ...overrides,
  });
  const blocked = (overrides: Record<string, unknown>, code: string) => {
    try { service.assertCanStart(valid(overrides), now); throw new Error('Expected compliance failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toEqual(expect.objectContaining({ code, message: expect.any(String) }));
    }
  };

  it('allows a valid verified driver to start', () => expect(service.assertCanStart(valid(), now).eligible).toBe(true));
  it('blocks an expired license', () => blocked({ licenseExpiresAt: new Date('2026-08-26T23:59:59.000Z') }, 'LICENSE_EXPIRED'));
  it('blocks a rejected license', () => blocked({ licenseVerificationStatus: VerificationStatus.REJECTED }, 'LICENSE_REJECTED'));
  it('blocks a suspended driver', () => blocked({ user: { accountStatus: AccountStatus.SUSPENDED } }, 'DRIVER_SUSPENDED'));
  it('blocks an unverified driver identity', () => blocked({ identityVerificationStatus: VerificationStatus.UNVERIFIED }, 'IDENTITY_NOT_VERIFIED'));
  it('blocks pending license verification', () => blocked({ licenseVerificationStatus: VerificationStatus.PENDING_VERIFICATION }, 'LICENSE_PENDING_VERIFICATION'));
  it('blocks pending license re-verification', () => blocked({ licenseVerificationStatus: VerificationStatus.PENDING_REVERIFICATION }, 'PENDING_REVERIFICATION'));
  it('allows an approved license expiring soon', () => expect(service.assertCanStart(valid({ licenseExpiresAt: new Date('2026-09-10T00:00:00.000Z') }), now).licenseValidity).toBe('EXPIRING_SOON'));
  it('marks seven days remaining as critical but eligible', () => { const result = service.assertCanStart(valid({ licenseExpiresAt: new Date('2026-09-03T00:00:00.000Z') }), now); expect(result).toEqual(expect.objectContaining({ eligible: true, licenseValidity: 'EXPIRING_CRITICAL', licenseDaysRemaining: 7 })); });
});
