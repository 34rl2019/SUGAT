import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma.service';
@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService) {}
  async login(dto: { email: string; password: string }) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password)) || user.accountStatus !== 'ACTIVE') throw new UnauthorizedException('Invalid credentials');
    return this.issue(user.id, user.role);
  }
  async refresh(token: string) {
    let payload: { sub: string; sid: string; role: any };
    try { payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_REFRESH_SECRET }); } catch { throw new UnauthorizedException(); }
    const session = await this.db.refreshSession.findUnique({ where: { id: payload.sid },include:{user:true} });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.accountStatus!=='ACTIVE' || !(await argon2.verify(session.tokenHash, token))) throw new UnauthorizedException();
    await this.db.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issue(payload.sub, session.user.role);
  }
  private async issue(userId: string, role: any) {
    const sid = randomUUID();
    const days=Number(process.env.REFRESH_TOKEN_TTL_DAYS??30);
    const accessToken = await this.jwt.signAsync({ sub: userId, role }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: (process.env.ACCESS_TOKEN_TTL??'15m') as any });
    const refreshToken = await this.jwt.signAsync({ sub: userId, role, sid }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: `${days}d` });
    await this.db.refreshSession.create({ data: { id: sid, userId, tokenHash: await argon2.hash(refreshToken), expiresAt: new Date(Date.now() + days * 86400_000) } });
    return { accessToken, refreshToken };
  }
}
