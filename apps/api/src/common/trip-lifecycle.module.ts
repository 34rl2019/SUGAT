import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { systemTripClock, TRIP_CLOCK, TripLifecycleService } from './trip-lifecycle.service';

@Global()
@Module({ providers: [PrismaService, TripLifecycleService, { provide: TRIP_CLOCK, useValue: systemTripClock }], exports: [TripLifecycleService] })
export class TripLifecycleModule {}
