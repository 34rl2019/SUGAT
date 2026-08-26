import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
@Module({ imports: [JwtModule.register({})], controllers: [AuthController], providers: [AuthService, PrismaService], exports: [JwtModule, AuthService] })
export class AuthModule {}
