import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { deviceCredentialHash, validDeviceCredential, DEVICE_REJECTED } from '../../common/device-credential';
import { PrismaService } from '../../common/prisma.service';
import { normalizeEmail } from '../../common/user-email';
@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService) {}
  async login(dto: { email: string; password: string; deviceCredential?: string }) {
    const user = await this.db.user.findUnique({ where: { email: normalizeEmail(dto.email) } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password)) || user.accountStatus !== 'ACTIVE') throw new UnauthorizedException('Invalid credentials');
    let driverDeviceId: string | undefined, deviceCredential: string | undefined;
    if (user.role === 'DRIVER') {
      const driver = await this.db.driver.findUnique({ where: { userId: user.id }, include: { authorizedDevice: true } });
      if (!driver?.active) throw new UnauthorizedException('Driver account is inactive');
      if (driver.authorizedDevice) {
        if (!validDeviceCredential(dto.deviceCredential, driver.authorizedDevice.credentialHash)) throw new ForbiddenException(DEVICE_REJECTED);
        driverDeviceId = driver.authorizedDevice.id;
      } else {
        deviceCredential = randomBytes(32).toString('hex');
        try {
          const device = await this.db.driverDevice.create({ data: { driverId: driver.id, credentialHash: deviceCredentialHash(deviceCredential) } });
          driverDeviceId = device.id;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ForbiddenException(DEVICE_REJECTED);
          throw error;
        }
      }
    }
    return { ...await this.issue(user.id, user.role, driverDeviceId), ...(deviceCredential ? { deviceCredential } : {}), mustChangePassword: user.role === 'DRIVER' && user.mustChangePassword };
  }
  async refresh(token: string, deviceCredential?: string) {
    let payload: { sub: string; sid: string; role: any };
    try { payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_REFRESH_SECRET }); } catch { throw new UnauthorizedException(); }
    const session = await this.db.refreshSession.findUnique({ where: { id: payload.sid },include:{user:true} });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || session.user.accountStatus!=='ACTIVE' || !(await argon2.verify(session.tokenHash, token))) throw new UnauthorizedException();
    if (session.user.role === 'DRIVER') {
      const device = session.driverDeviceId ? await this.db.driverDevice.findUnique({ where: { id: session.driverDeviceId }, include: { driver: true } }) : null;
      if (!device || device.driver.userId !== session.userId || !device.driver.active || !validDeviceCredential(deviceCredential, device.credentialHash)) throw new UnauthorizedException('Driver device authorization was revoked. Please contact the administrator.');
    }
    const revoked = await this.db.refreshSession.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    if (revoked.count !== 1) throw new UnauthorizedException();
    return { ...await this.issue(payload.sub, session.user.role, session.driverDeviceId ?? undefined), mustChangePassword: session.user.role === 'DRIVER' && session.user.mustChangePassword };
  }
  async logout(userId: string, token: string) {
    const payload = await this.refreshPayload(token, userId);
    await this.db.refreshSession.updateMany({ where: { id: payload.sid, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  async logoutAll(userId: string) {
    await this.db.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  async changePassword(userId: string, currentPassword: string, newPassword: string, driverDeviceId?: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.accountStatus !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, currentPassword))) throw new UnauthorizedException('Current password is incorrect');
    if (await argon2.verify(user.passwordHash, newPassword)) throw new BadRequestException('New password must be different from the current password');
    const passwordHash = await argon2.hash(newPassword);
    await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: userId, action: 'account.password.changed', entityType: 'User', entityId: userId } });
    });
    return { ...await this.issue(user.id, user.role, driverDeviceId), mustChangePassword: false };
  }
  private async refreshPayload(token: string, expectedUserId?: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token, { secret: process.env.JWT_REFRESH_SECRET });
      if (!payload.sid || (expectedUserId && payload.sub !== expectedUserId)) throw new Error('Session mismatch');
      return payload;
    } catch { throw new UnauthorizedException('Invalid refresh session'); }
  }
  private async issue(userId: string, role: any, driverDeviceId?: string) {
    const sid = randomUUID();
    const days=Number(process.env.REFRESH_TOKEN_TTL_DAYS??30);
    const accessToken = await this.jwt.signAsync({ sub: userId, role, sid }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: (process.env.ACCESS_TOKEN_TTL??'15m') as any });
    const refreshToken = await this.jwt.signAsync({ sub: userId, role, sid }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: `${days}d` });
    await this.db.refreshSession.create({ data: { id: sid, userId, driverDeviceId, tokenHash: await argon2.hash(refreshToken), expiresAt: new Date(Date.now() + days * 86400_000) } });
    return { accessToken, refreshToken };
  }
}
