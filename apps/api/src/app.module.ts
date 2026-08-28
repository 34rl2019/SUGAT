import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './common/prisma.service';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { TripsModule } from './modules/trips/trips.module';
import { LiveModule } from './modules/live/live.module';
import { AdminModule } from './modules/admin/admin.module';
import { VerificationModule } from './modules/verification/verification.module';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), AuthModule, LiveModule, TripsModule, AdminModule, VerificationModule], controllers: [HealthController], providers: [PrismaService,{provide:APP_GUARD,useClass:ThrottlerGuard}] })
export class AppModule {}
