import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { AuthService } from './auth.service';

describe('AuthService session lifecycle', () => {
  const user = { id: 'user-1', email: 'driver@example.test', passwordHash: '', role: 'DRIVER', accountStatus: 'ACTIVE', mustChangePassword: false };
  async function setup(overrides: Record<string, unknown> = {}) {
    user.role = 'DRIVER'; user.mustChangePassword = false;
    user.passwordHash = await argon2.hash('Current password 123');
    const sessions = new Map<string, any>(); let binding:any=null;
    const db: any = {
      driver: {findUnique:jest.fn(async()=>({id:'driver-1',active:true,authorizedDevice:binding}))},
      driverDevice:{create:jest.fn(async({data})=>(binding={id:'device-1',...data,driver:{userId:user.id,active:true}})),findUnique:jest.fn(async()=>binding)},
      user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn() },
      refreshSession: {
        create: jest.fn(({ data }) => { sessions.set(data.id, { ...data, revokedAt: null, user }); return data; }),
        findUnique: jest.fn(({ where }) => sessions.get(where.id) ?? null),
        updateMany: jest.fn(({ where, data }) => { const session = sessions.get(where.id); if (where.id && (!session || session.revokedAt || (where.expiresAt?.gt && session.expiresAt <= where.expiresAt.gt))) return { count: 0 }; if (where.id) { Object.assign(session, data); return { count: 1 }; } let count = 0; for (const value of sessions.values()) if (value.userId === where.userId && !value.revokedAt) { Object.assign(value, data); count++; } return { count }; }),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((callback: Function) => callback(db)),
      ...overrides,
    };
    const jwt: any = {
      signAsync: jest.fn(async (payload: any) => `signed:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`),
      verifyAsync: jest.fn(async (token: string) => JSON.parse(Buffer.from(token.slice(7), 'base64url').toString())),
    };
    jest.spyOn(argon2, 'hash').mockImplementation(async (value: string | Buffer) => `hash:${String(value)}` as never);
    jest.spyOn(argon2, 'verify').mockImplementation(async (hash: string, value: string | Buffer) => hash === `hash:${String(value)}` || (hash === user.passwordHash && String(value) === 'Current password 123'));
    return { service: new AuthService(db, jwt), db, sessions };
  }
  afterEach(() => jest.restoreAllMocks());

  it('logs in active accounts and rejects an invalid password', async () => {
    const { service } = await setup();
    await expect(service.login({ email: user.email, password: 'Current password 123' })).resolves.toHaveProperty('refreshToken');
    await expect(service.login({ email: user.email, password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('scopes forced temporary-password changes to driver accounts', async () => {
    const { service } = await setup();
    user.role='ADMIN';user.mustChangePassword=true;
    await expect(service.login({email:user.email,password:'Current password 123'})).resolves.toMatchObject({mustChangePassword:false});
  });
  it('rotates once and rejects reuse of the old refresh token', async () => {
    const { service } = await setup(); const first = await service.login({ email: user.email, password: 'Current password 123' });
    await expect(service.refresh(first.refreshToken, first.deviceCredential)).resolves.toHaveProperty('refreshToken');
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects revoked and expired sessions', async () => {
    const { service, sessions } = await setup(); const issued = await service.login({ email: user.email, password: 'Current password 123' });
    const session = [...sessions.values()][0]; session.revokedAt = new Date();
    await expect(service.refresh(issued.refreshToken, issued.deviceCredential)).rejects.toBeInstanceOf(UnauthorizedException);
    session.revokedAt = null; session.expiresAt = new Date(0);
    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('revokes the current session on logout and treats repeated logout safely', async () => {
    const { service } = await setup(); const issued = await service.login({ email: user.email, password: 'Current password 123' });
    await service.logout(user.id, issued.refreshToken); await service.logout(user.id, issued.refreshToken);
    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('changes a password, revokes prior sessions, and rejects reuse of the same password', async () => {
    const { service, db } = await setup(); await service.login({ email: user.email, password: 'Current password 123' });
    await expect(service.changePassword(user.id, 'Current password 123', 'A much better passphrase')).resolves.toHaveProperty('refreshToken');
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: false }) }));
    expect(db.auditLog.create).toHaveBeenCalled();
    await expect(service.changePassword(user.id, 'wrong', 'Another secure passphrase')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.changePassword(user.id, 'Current password 123', 'Current password 123')).rejects.toBeInstanceOf(BadRequestException);
  });
});
