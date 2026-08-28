import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccountStatus, VerificationStatus } from '@prisma/client';

export type ComplianceCode =
  | 'DRIVER_INACTIVE'
  | 'DRIVER_SUSPENDED'
  | 'IDENTITY_NOT_VERIFIED'
  | 'IDENTITY_REJECTED'
  | 'IDENTITY_PENDING_VERIFICATION'
  | 'IDENTITY_PENDING_REVERIFICATION'
  | 'LICENSE_NOT_VERIFIED'
  | 'LICENSE_REJECTED'
  | 'LICENSE_PENDING_VERIFICATION'
  | 'PENDING_REVERIFICATION'
  | 'LICENSE_EXPIRED';

type DriverComplianceRecord = {
  active: boolean;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  identityVerificationStatus: VerificationStatus;
  licenseVerificationStatus: VerificationStatus;
  user: { accountStatus: AccountStatus };
};

export type DriverCompliance = {
  eligible: boolean;
  code: ComplianceCode | null;
  message: string | null;
  licenseValidity: 'VALID' | 'EXPIRING_SOON' | 'EXPIRING_CRITICAL' | 'EXPIRED' | 'NOT_ON_FILE';
  licenseDaysRemaining: number | null;
};

const messages: Record<ComplianceCode, string> = {
  DRIVER_INACTIVE: 'This driver account is inactive and cannot start a trip.',
  DRIVER_SUSPENDED: 'This driver account is suspended and cannot start a trip.',
  IDENTITY_NOT_VERIFIED: 'Your identity has not yet been verified.',
  IDENTITY_REJECTED: 'Your identity verification was rejected. Please submit valid documents for verification.',
  IDENTITY_PENDING_VERIFICATION: 'Your identity verification is still pending.',
  IDENTITY_PENDING_REVERIFICATION: 'Your updated identity documents are still pending verification.',
  LICENSE_NOT_VERIFIED: "Your driver's license has not yet been verified.",
  LICENSE_REJECTED: "The submitted driver's license was rejected. Please submit valid documents for verification.",
  LICENSE_PENDING_VERIFICATION: "Your driver's license is still pending verification.",
  PENDING_REVERIFICATION: "Your updated driver's license is still pending verification.",
  LICENSE_EXPIRED: "Your driver's license on file has expired. Update and re-verify your license before starting a trip.",
};

@Injectable()
export class DriverComplianceService {
  evaluate(driver: DriverComplianceRecord, now = new Date()): DriverCompliance {
    const expiration = driver.licenseExpiresAt;
    const millisecondsRemaining = expiration ? expiration.getTime() - now.getTime() : null;
    const daysRemaining = millisecondsRemaining === null ? null : Math.ceil(millisecondsRemaining / 86_400_000);
    const licenseValidity: DriverCompliance['licenseValidity'] = daysRemaining === null ? 'NOT_ON_FILE' : millisecondsRemaining! < 0 ? 'EXPIRED' : daysRemaining <= 7 ? 'EXPIRING_CRITICAL' : daysRemaining <= 30 ? 'EXPIRING_SOON' : 'VALID';
    const failure = this.failure(driver, licenseValidity);
    return { eligible: !failure, code: failure, message: failure ? messages[failure] : null, licenseValidity, licenseDaysRemaining: daysRemaining };
  }

  assertCanStart(driver: DriverComplianceRecord, now = new Date()): DriverCompliance {
    const result = this.evaluate(driver, now);
    if (!result.eligible) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: result.code, message: result.message });
    return result;
  }

  private failure(driver: DriverComplianceRecord, validity: DriverCompliance['licenseValidity']): ComplianceCode | null {
    if (!driver.active || driver.user.accountStatus === AccountStatus.DISABLED) return 'DRIVER_INACTIVE';
    if (driver.user.accountStatus === AccountStatus.SUSPENDED) return 'DRIVER_SUSPENDED';
    const identity = this.verificationFailure(driver.identityVerificationStatus, 'IDENTITY');
    if (identity) return identity;
    const license = this.verificationFailure(driver.licenseVerificationStatus, 'LICENSE');
    if (license) return license;
    if (!driver.licenseNumber || validity === 'NOT_ON_FILE') return 'LICENSE_NOT_VERIFIED';
    if (validity === 'EXPIRED') return 'LICENSE_EXPIRED';
    return null;
  }

  private verificationFailure(status: VerificationStatus, kind: 'IDENTITY' | 'LICENSE'): ComplianceCode | null {
    if (status === VerificationStatus.APPROVED) return null;
    if (status === VerificationStatus.REJECTED) return `${kind}_REJECTED` as ComplianceCode;
    if (status === VerificationStatus.PENDING_VERIFICATION) return `${kind}_PENDING_VERIFICATION` as ComplianceCode;
    if (status === VerificationStatus.PENDING_REVERIFICATION) return kind === 'LICENSE' ? 'PENDING_REVERIFICATION' : 'IDENTITY_PENDING_REVERIFICATION';
    return `${kind}_NOT_VERIFIED` as ComplianceCode;
  }
}
