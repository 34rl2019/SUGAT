import { Body, Controller, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength, MinLength, ValidateIf, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request, Response } from 'express';
import { AllowPasswordChange, AuthUser, CurrentUser, JwtGuard } from '../../common/auth';
import { AuthService } from './auth.service';
class LoginDto { @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() email!: string; @IsString() @MaxLength(1024) password!: string; @IsOptional() @Matches(/^[a-f0-9]{64}$/) deviceCredential?: string }
class RefreshDto { @ValidateIf((_object, value) => value !== undefined) @IsString() refreshToken?: string; @IsOptional() @Matches(/^[a-f0-9]{64}$/) deviceCredential?: string }
class LogoutDto extends RefreshDto {}
class ChangePasswordDto { @IsString() @MaxLength(1024) currentPassword!: string; @IsString() @MinLength(12) @MaxLength(128) newPassword!: string }
const COOKIE = 'sugat_admin_refresh';
const cookieToken = (request: Request) => request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/v1/auth', maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000 });
const cookieClearOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/v1/auth' });
const webClient = (request: Request) => request.header('x-sugat-client') === 'admin-web';
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Throttle({ auth: { limit: 5, ttl: 60_000 } }) @Post('login') async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.webResponse(await this.auth.login(dto), req, res); }
  @Throttle({ auth: { limit: 20, ttl: 60_000 } }) @Post('refresh') async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? cookieToken(req); if (!token) throw new UnauthorizedException('Refresh token required');
    return this.webResponse(await this.auth.refresh(token, dto.deviceCredential), req, res);
  }
  @UseGuards(JwtGuard) @AllowPasswordChange() @Post('logout') async logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? cookieToken(req); if (token) await this.auth.logout(user.sub, token); res.clearCookie(COOKIE, cookieClearOptions()); return { success: true };
  }
  @UseGuards(JwtGuard) @AllowPasswordChange() @Post('logout-all') async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) { await this.auth.logoutAll(user.sub); res.clearCookie(COOKIE, cookieClearOptions()); return { success: true }; }
  @Throttle({ auth: { limit: 5, ttl: 60_000 } }) @UseGuards(JwtGuard) @AllowPasswordChange() @Post('change-password') async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.webResponse(await this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword, user.driverDeviceId), req, res); }
  private webResponse(session: { accessToken: string; refreshToken: string; mustChangePassword?: boolean }, request: Request, response: Response) {
    if (!webClient(request)) return session;
    response.cookie(COOKIE, session.refreshToken, cookieOptions());
    const { refreshToken: _refreshToken, ...safe } = session; return safe;
  }
}
