import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma.service';
import { JwtGuard } from '../../common/auth';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { LiveModule } from '../live/live.module';
@Module({ imports: [JwtModule.register({}),LiveModule], controllers: [TripsController], providers: [TripsService, PrismaService, JwtGuard], exports: [TripsService] })
export class TripsModule {}
