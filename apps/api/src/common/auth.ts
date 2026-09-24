import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { validDeviceCredential } from './device-credential';
export interface AuthUser { sub: string; role: Role; sid?: string; driverDeviceId?: string }
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const AllowPasswordChange = () => SetMetadata('allowPasswordChange', true);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector,private db:PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException();
    try { req.user = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET }); }
    catch { throw new UnauthorizedException('Invalid or expired access token'); }
    const account=await this.db.user.findUnique({where:{id:req.user.sub},select:{role:true,accountStatus:true,mustChangePassword:true}});
    if(!account||account.accountStatus!=='ACTIVE'||account.role!==req.user.role)throw new UnauthorizedException('Account is inactive or session is obsolete');
    const allowPasswordChange = this.reflector.getAllAndOverride<boolean>('allowPasswordChange', [ctx.getHandler(), ctx.getClass()]);
    if(account.role===Role.DRIVER&&account.mustChangePassword&&!allowPasswordChange)throw new ForbiddenException('Password change required');
    if (account.role === Role.DRIVER) {
      const session = req.user.sid ? await this.db.refreshSession.findUnique({ where: { id: req.user.sid } }) : null;
      const device = session?.driverDeviceId ? await this.db.driverDevice.findUnique({ where: { id: session.driverDeviceId }, include: { driver: true } }) : null;
      if (!session || session.userId !== req.user.sub || session.revokedAt || session.expiresAt <= new Date() || !device || device.driver.userId !== req.user.sub || !device.driver.active || !validDeviceCredential(req.headers['x-sugat-device-credential'], device.credentialHash)) throw new UnauthorizedException('Driver device or session authorization expired or was revoked. Please log in again.');
      req.user.driverDeviceId = device.id;
    }
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
