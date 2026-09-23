import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';
import { livePolicy } from '../../common/live-policy';
import { LiveGateway } from '../live/live.gateway';
import { DriverComplianceService } from '../../common/driver-compliance.service';
import { Prisma } from '@prisma/client';
import {
  TripLifecycleService,
  tripLifecyclePolicy,
} from '../../common/trip-lifecycle.service';
import { operatingTrip, startedSegmentEvents } from '../../common/trip-route-stops';

type Event = {
  eventId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number;
  heading?: number;
  recordedAt: string;
};

type IngestDisposition =
  | 'PROMOTED'
  | 'STALE'
  | 'SUSPICIOUS'
  | 'DUPLICATE'
  | 'TERMINAL_INVALID';

type IngestResult = {
  eventId: string;
  disposition: IngestDisposition;
  accepted: boolean;
  duplicate: boolean;
  suspicious: boolean;
  promoted: boolean;
  rejectionReason: string | null;
};

const meters = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const r = 6371e3;
  const p = (x: number) => (x * Math.PI) / 180;

  const dlat = p(b.latitude - a.latitude);
  const dlng = p(b.longitude - a.longitude);

  const v =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(p(a.latitude)) *
      Math.cos(p(b.latitude)) *
      Math.sin(dlng / 2) ** 2;

  return 2 * r * Math.asin(Math.sqrt(v));
};

@Injectable()
export class TripsService {
  private lastGpsCleanupAt = 0;

  constructor(
    private db: PrismaService,
    private live: LiveGateway,
    private compliance: DriverComplianceService,
    private lifecycle: TripLifecycleService,
  ) {}

  async operations(userId: string) {
    const driver = await this.driver(userId);

    const [vehicles, routes, stops, activeTrip] =
      await Promise.all([
        this.db.vehicle.findMany({
          where: {
            assignedDriverId: driver.id,
            active: true,
          },
          select: {
            id: true,
            displayName: true,
            type: true,
            plateNumber: true,
            capacity: true,
          },
          orderBy: {
            displayName: 'asc',
          },
        }),

        this.db.route.findMany({
          where: {
            active: true,
          },
          select: {
            id: true,
            name: true,
            direction: true,
            stops: {
              where: {
                stop: {
                  active: true,
                },
              },
              select: {
                stopId: true,
                sequence: true,
                boardingAllowed: true,
                dropoffAllowed: true,
              },
              orderBy: {
                sequence: 'asc',
              },
            },
          },
          orderBy: [
            {
              name: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        }),

        this.db.stop.findMany({
          where: {
            active: true,
          },
          select: {
            id: true,
            name: true,
            cityMunicipality: true,
            province: true,
          },
          orderBy: [
            {
              name: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        }),

        this.db.trip.findFirst({
          where: {
            driverId: driver.id,
            status: 'ACTIVE',
          },
          include: {
            vehicle: true,
            events: {
              where: {
                type: 'STARTED',
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
            route: {
              include: {
                stops: {
                  include: {
                    stop: true,
                  },
                  orderBy: {
                    sequence: 'asc',
                  },
                },
              },
            },
          },
        }),
      ]);


    return {
      vehicles,
      routes,
      stops,
      activeTrip: activeTrip ? operatingTrip(activeTrip) : null,
      compliance: this.compliance.evaluate(driver),
    };
  }

  /**
   * Starts a new autonomous trip directly from the
   * driver's authorized route and registered vehicle.
   *
   * Start and destination stop IDs are stored in the
   * STARTED TripEvent metadata because the Trip model
   * does not contain startStopId/destinationStopId columns.
   */
  async startAutonomous(
    userId: string,
    routeId: string,
    vehicleId?: string,
    startStopId?: string,
    destinationStopId?: string,
  ) {
    try {
      const trip = await this.db.$transaction(
        async tx => {
          const driver = await tx.driver.findUnique({
            where: {
              userId,
            },
            include: {
              user: true,
            },
          });

          if (!driver) {
            throw new ForbiddenException(
              'A driver profile is required.',
            );
          }

          this.compliance.assertCanStart(driver);

          if (!routeId) {
            throw new BadRequestException(
              'A route is required.',
            );
          }

          if (!startStopId || !destinationStopId) {
            throw new BadRequestException(
              'Both start location and destination are required.',
            );
          }

          const route = await tx.route.findUnique({
            where: {
              id: routeId,
            },
            include: {
              stops: {
                where: {
                  stop: {
                    active: true,
                  },
                },
                include: {
                  stop: true,
                },
                orderBy: {
                  sequence: 'asc',
                },
              },
            },
          });

          if (!route) {
            throw new NotFoundException(
              'Route not found.',
            );
          }

          if (!route.active) {
            throw new ForbiddenException(
              'This route is inactive.',
            );
          }

          const routeStops = route.stops.filter(stop => stop.stop.active);

          const start = routeStops.find(
            stop => stop.stopId === startStopId,
          );

          const destination = routeStops.find(
            stop => stop.stopId === destinationStopId,
          );

          if (!start) {
            throw new BadRequestException(
              'Selected start location is not part of this route.',
            );
          }

          if (!destination) {
            throw new BadRequestException(
              'Selected destination is not part of this route.',
            );
          }

          if (
            start.sequence >= destination.sequence
          ) {
            throw new BadRequestException(
              'Destination must be after the selected start location.',
            );
          }

          if (!start.boardingAllowed || !destination.dropoffAllowed) {
            throw new BadRequestException('The selected stops do not permit boarding and dropoff.');
          }

          /*
           * The vehicle must be:
           * - registered
           * - active
           * - assigned to this driver
           */
          const vehicles = await tx.vehicle.findMany({
            where: {
              ...(vehicleId
                ? {
                    id: vehicleId,
                  }
                : {}),

              assignedDriverId: driver.id,

              active: true,
            },
          });

          if (vehicles.length !== 1) {
            throw new ForbiddenException(
              'Select one registered vehicle assigned to this driver.',
            );
          }

          const vehicle = vehicles[0];

          /*
           * Prevent the driver or vehicle from starting
           * another active trip.
           */
          const conflict = await tx.trip.findFirst({
            where: {
              status: 'ACTIVE',

              OR: [
                {
                  driverId: driver.id,
                },
                {
                  vehicleId: vehicle.id,
                },
              ],
            },
          });

          if (conflict) {
            throw this.startConflict();
          }

          const now = this.lifecycle.now();

          /*
           * Create the active trip.
           *
           * Occupancy starts as VACANT.
           */
          const active = await tx.trip.create({
            data: {
              driverId: driver.id,
              vehicleId: vehicle.id,
              routeId: route.id,
              status: 'ACTIVE',
              startedAt: now,
              occupancyStatus: 'VACANT',
              occupancyUpdatedAt: now,
              lastPassedSequence: start.sequence - 1,
            },
          });

          /*
           * Trip does not have startStopId/destinationStopId
           * columns.
           *
           * Store the selected passenger segment inside the
           * STARTED TripEvent metadata instead.
           */
          await tx.tripEvent.create({
            data: {
              tripId: active.id,
              type: 'STARTED',
              metadata: {
                startStopId,
                destinationStopId,
              },
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: userId,
              action: 'trip.started',
              entityType: 'Trip',
              entityId: active.id,
              metadata: {
                routeId: route.id,
                vehicleId: vehicle.id,
                startStopId,
                destinationStopId,
              },
            },
          });

          return active;
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      this.live.publishStarted(trip.id);

      return trip;
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw this.startConflict();
      }

      throw error;
    }
  }

  async setOccupancy(
    userId: string,
    tripId: string,
    occupancyStatus:
      | 'VACANT'
      | 'FULL',
  ) {
    const driver =
      await this.driver(userId);

    const result =
      await this.db.$transaction(
        async tx => {
          const current =
            await tx.trip.findUnique({
              where: {
                id: tripId,
              },
            });

          if (
            !current ||
            current.driverId !==
              driver.id ||
            current.status !==
              'ACTIVE'
          ) {
            throw new ForbiddenException(
              'Only your active trip can change occupancy.',
            );
          }

          const updatedAt =
            new Date(
              Math.max(
                this.lifecycle
                  .now()
                  .getTime(),
                (current.occupancyUpdatedAt?.getTime() ??
                  0) + 1,
              ),
            );

          const changed =
            await tx.trip.updateMany({
              where: {
                id: tripId,
                driverId: driver.id,
                status: 'ACTIVE',
              },
              data: {
                occupancyStatus,
                occupancyUpdatedAt:
                  updatedAt,
              },
            });

          if (changed.count !== 1) {
            throw new ForbiddenException(
              'Only your active trip can change occupancy.',
            );
          }

          const trip =
            await tx.trip.findUniqueOrThrow(
              {
                where: {
                  id: tripId,
                },
              },
            );

          return {
            tripId,
            vehicleId:
              trip.vehicleId,
            occupancyStatus:
              trip.occupancyStatus,
            updatedAt:
              trip.occupancyUpdatedAt,
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      ).catch(error => {
        if (
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          throw new ConflictException(
            'Trip changed while updating occupancy. Please retry.',
          );
        }

        throw error;
      });

    this.live.publishOccupancy(
      tripId,
      result,
    );

    return result;
  }

  async driver(userId: string) {
    const d =
      await this.db.driver.findUnique({
        where: {
          userId,
        },
        include: {
          user: true,
        },
      });

    if (!d) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'DRIVER_PROFILE_REQUIRED',
        message:
          'A driver profile is required.',
      });
    }

    return d;
  }

  async assignment(userId: string) {
    const d =
      await this.driver(userId);

    await this.lifecycle.reconcile(
      d.id,
    );

    const include = {
      events: startedSegmentEvents,
      driver: {
        select: {
          firstName: true,
          lastName: true,
        },
      },

      vehicle: true,

      route: {
        include: {
          stops: {
            include: {
              stop: true,
            },
            orderBy: {
              sequence:
                'asc' as const,
            },
          },
        },
      },
    };

    const active =
      await this.db.trip.findFirst({
        where: {
          driverId: d.id,
          status: 'ACTIVE',
        },
        include,
        orderBy: {
          startedAt: 'asc',
        },
      });

    const ready = active
      ? null
      : await this.db.trip.findFirst({
          where: {
            driverId: d.id,
            status: 'READY',
          },
          include,
          orderBy: {
            scheduledDepartureAt:
              'asc',
          },
        });

    const scheduled =
      active || ready
        ? null
        : await this.db.trip.findFirst({
            where: {
              driverId: d.id,
              status: 'SCHEDULED',
            },
            include,
            orderBy: {
              scheduledDepartureAt:
                'asc',
            },
          });

    const trip =
      active ??
      ready ??
      scheduled;

    if (!trip) {
      return null;
    }

    const timing =
      this.lifecycle.timing(
        trip.scheduledDepartureAt ??
          trip.startedAt ??
          this.lifecycle.now(),
      );

    return {
      ...operatingTrip(trip),

      compliance:
        this.compliance.evaluate(d),

      canStart:
        trip.status === 'READY' &&
        this.lifecycle.now() <=
          timing.startDeadlineAt,

      startAvailableAt:
        timing.readyAt,

      startDeadlineAt:
        timing.startDeadlineAt,

      readinessPolicy: {
        readyBeforeMinutes:
          tripLifecyclePolicy.readyBeforeMinutes,

        startGraceAfterMinutes:
          tripLifecyclePolicy.startGraceAfterMinutes,
      },
    };
  }

  async start(
    userId: string,
    id: string,
  ) {
    const d =
      await this.driver(userId);

    this.compliance.assertCanStart(d);

    await this.lifecycle.reconcileTrip(
      id,
    );

    const trip =
      await this.db.trip.findUnique({
        where: {
          id,
        },
        include: {
          vehicle: true,
          route: true,
        },
      });

    if (
      !trip ||
      trip.driverId !== d.id
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'TRIP_NOT_ASSIGNED',
        message:
          'Trip is not assigned to this driver.',
      });
    }

    const now =
      this.lifecycle.now();

    const timing =
      this.lifecycle.timing(
        trip.scheduledDepartureAt ??
          trip.startedAt ??
          this.lifecycle.now(),
      );

    if (
      ['COMPLETED', 'CANCELLED'].includes(
        trip.status,
      )
    ) {
      throw this.startConflict(
        'TRIP_NOT_READY',
        'Terminal trips cannot be started.',
      );
    }

    if (now < timing.readyAt) {
      throw this.startConflict(
        'TRIP_TOO_EARLY',
        `Trip can start from ${timing.readyAt.toISOString()}.`,
      );
    }

    if (
      now >
      timing.startDeadlineAt
    ) {
      throw this.startConflict(
        'TRIP_START_WINDOW_EXPIRED',
        'The trip start window has expired.',
      );
    }

    if (trip.status !== 'READY') {
      throw this.startConflict(
        'TRIP_NOT_READY',
        'Only a ready trip can start.',
      );
    }

    if (
      !trip.vehicle.active ||
      trip.vehicle.assignedDriverId !==
        d.id
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'VEHICLE_NOT_AUTHORIZED',
        message:
          'This driver is not authorized to operate the assigned vehicle.',
      });
    }

    if (
      !(
        await this.db
          .driverRouteAuthorization
          .findUnique({
            where: {
              driverId_routeId: {
                driverId: d.id,
                routeId:
                  trip.routeId,
              },
            },
          })
      )
    ) {
      throw new ForbiddenException(
        'Route is not authorized for this driver.',
      );
    }

    if (!trip.route.active) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'ROUTE_NOT_AUTHORIZED',
        message:
          'This route is inactive or no longer authorized for this trip.',
      });
    }

    const conflict =
      await this.db.trip.findFirst({
        where: {
          id: {
            not: id,
          },
          status: 'ACTIVE',
          OR: [
            {
              driverId: d.id,
            },
            {
              vehicleId:
                trip.vehicleId,
            },
          ],
        },
      });

    if (conflict) {
      throw this.startConflict();
    }

    try {
      const active =
        await this.db.$transaction(
          async tx => {
            const changed =
              await tx.trip.updateMany({
                where: {
                  id,
                  status: 'READY',
                },
                data: {
                  status: 'ACTIVE',
                  startedAt: now,
                  occupancyStatus:
                    'VACANT',
                  occupancyUpdatedAt:
                    now,
                },
              });

            if (changed.count !== 1) {
              throw this.startConflict(
                'TRIP_NOT_READY',
                'Only a ready trip can start.',
              );
            }

            const t =
              await tx.trip.findUniqueOrThrow(
                {
                  where: {
                    id,
                  },
                },
              );

            await tx.tripEvent.create({
              data: {
                tripId: id,
                type: 'STARTED',
              },
            });

            await tx.auditLog.create({
              data: {
                actorId: userId,
                action:
                  'trip.started',
                entityType:
                  'Trip',
                entityId: id,
              },
            });

            return t;
          },
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
          },
        );

      this.live.publishStarted(id);

      return active;
    } catch (error) {
      if (
        error instanceof
        ConflictException
      ) {
        throw error;
      }

      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(
          error.code,
        )
      ) {
        throw this.startConflict();
      }

      throw error;
    }
  }

  private startConflict(
    code =
      'ACTIVE_TRIP_CONFLICT',
    message =
      'Driver or vehicle is already on an active trip.',
  ) {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code,
      message,
    });
  }

  async ingest(
    userId: string,
    tripId: string,
    e: Event,
  ) {
    const trip =
      await this.ingestContext(
        userId,
        tripId,
      );

    return this.ingestActiveEvent(
      trip,
      tripId,
      e,
    );
  }

  private async ingestContext(
    userId: string,
    tripId: string,
  ) {
    const d =
      await this.driver(userId);

    await this.cleanupGpsEvents();

    const trip =
      await this.db.trip.findUnique({
        where: {
          id: tripId,
        },
        include: {
          currentLocation: true,
          events: startedSegmentEvents,

          route: {
            include: {
              stops: {
                include: {
                  stop: true,
                },
                orderBy: {
                  sequence: 'asc',
                },
              },
            },
          },
        },
      });

    if (!trip) {
      throw new NotFoundException();
    }

    if (
      trip.driverId !== d.id ||
      trip.status !== 'ACTIVE'
    ) {
      throw new ForbiddenException(
        'Trip ownership or state invalid',
      );
    }

    return operatingTrip(trip);
  }

  private timestampRejection(
    trip: any,
    recordedAt: string,
  ) {
    const at =
      new Date(recordedAt);

    if (
      !Number.isFinite(
        at.getTime(),
      )
    ) {
      return {
        at,
        reason:
          'INVALID_TIMESTAMP',
      };
    }

    if (
      at.getTime() >
      Date.now() + 2 * 60_000
    ) {
      return {
        at,
        reason:
          'TIMESTAMP_TOO_FAR_IN_FUTURE',
      };
    }

    if (
      !trip.startedAt ||
      at.getTime() <
        trip.startedAt.getTime() -
          60_000
    ) {
      return {
        at,
        reason:
          'TIMESTAMP_BEFORE_ACTIVE_TRIP',
      };
    }

    return {
      at,
      reason: null,
    };
  }

  private async ingestActiveEvent(
    trip: any,
    tripId: string,
    e: Event,
  ): Promise<IngestResult> {
    const duplicate =
      await this.db.gpsIngestionEvent.findUnique(
        {
          where: {
            eventId: e.eventId,
          },
          select: {
            status: true,
            rejectionReason: true,
          },
        },
      );

    if (duplicate) {
      return this.duplicateResult(
        e.eventId,
        duplicate,
      );
    }

    const timestamp =
      this.timestampRejection(
        trip,
        e.recordedAt,
      );

    if (timestamp.reason) {
      return this.recordRejectedEvent(
        tripId,
        e.eventId,
        timestamp.reason,
        'TERMINAL_INVALID',
      );
    }

    const at =
      timestamp.at;

    const stale = Boolean(
      trip.currentLocation &&
        at.getTime() <=
          trip.currentLocation.recordedAt.getTime(),
    );

    let rejectionReason:
      | string
      | null =
      e.accuracy > 200
        ? 'ACCURACY_EXCEEDS_200_METERS'
        : null;

    if (
      trip.currentLocation &&
      !stale &&
      !rejectionReason
    ) {
      const seconds =
        (at.getTime() -
          trip.currentLocation.recordedAt.getTime()) /
        1000;

      if (
        meters(
          trip.currentLocation,
          e,
        ) /
          seconds >
          55 ||
        (e.speed ?? 0) > 55
      ) {
        rejectionReason =
          'IMPOSSIBLE_SPEED';
      }
    }

    if (rejectionReason) {
      return this.recordRejectedEvent(
        tripId,
        e.eventId,
        rejectionReason,
        'SUSPICIOUS',
      );
    }

    const expiresAt =
      new Date(
        Date.now() +
          this.gpsTtlHours() *
            3_600_000,
      );

    try {
      let stopNotification: Awaited<ReturnType<TripsService['detectStops']>>;
      const promoted =
        await this.db.$transaction(
          async tx => {
            const current = await this.lockTrip(tx, tripId);
            if (!current || current.status !== 'ACTIVE' || current.driverId !== trip.driverId) {
              throw new ForbiddenException('Trip ownership or state invalid');
            }
            trip.lastPassedSequence = Math.max(trip.lastPassedSequence, current.lastPassedSequence);
            const changed =
              await tx.$executeRaw`
                INSERT INTO "VehicleCurrentLocation"
                (
                  "tripId",
                  "vehicleId",
                  "latitude",
                  "longitude",
                  "accuracy",
                  "speed",
                  "heading",
                  "recordedAt",
                  "updatedAt"
                )
                VALUES
                (
                  ${tripId}::uuid,
                  ${trip.vehicleId}::uuid,
                  ${e.latitude},
                  ${e.longitude},
                  ${e.accuracy},
                  ${e.speed ?? null},
                  ${e.heading ?? null},
                  ${at},
                  CURRENT_TIMESTAMP
                )
                ON CONFLICT ("tripId")
                DO UPDATE SET
                  "vehicleId" =
                    EXCLUDED."vehicleId",
                  "latitude" =
                    EXCLUDED."latitude",
                  "longitude" =
                    EXCLUDED."longitude",
                  "accuracy" =
                    EXCLUDED."accuracy",
                  "speed" =
                    EXCLUDED."speed",
                  "heading" =
                    EXCLUDED."heading",
                  "recordedAt" =
                    EXCLUDED."recordedAt",
                  "updatedAt" =
                    CURRENT_TIMESTAMP
                WHERE
                  "VehicleCurrentLocation"."recordedAt"
                  <
                  EXCLUDED."recordedAt"
              `;

            const wasPromoted =
              changed === 1;

            await tx.gpsIngestionEvent.create({
              data: {
                eventId:
                  e.eventId,
                tripId,
                status:
                  wasPromoted
                    ? 'PROMOTED'
                    : 'STALE',
                rejectionReason:
                  wasPromoted
                    ? null
                    : 'STALE_LOCATION',
                expiresAt,
              },
            });

            if (wasPromoted) {
              await tx.trip.updateMany({
                where: {
                  id: tripId,
                  OR: [
                    {
                      lastLocationAt:
                        null,
                    },
                    {
                      lastLocationAt: {
                        lt: at,
                      },
                    },
                  ],
                },
                data: {
                  lastLocationAt:
                    at,
                },
              });
            }

            if (wasPromoted) stopNotification = await this.detectStops(tx, trip, e);
            return wasPromoted;
          },
        );

      if (!promoted) {
        return {
          eventId:
            e.eventId,
          disposition:
            'STALE',
          accepted: true,
          duplicate: false,
          suspicious: false,
          promoted: false,
          rejectionReason:
            'STALE_LOCATION',
        };
      }

      // The write has committed. Hold the same row lock as completion while
      // publishing so an ended trip cannot publish a late location/stop event.
      await this.db.$transaction(async tx => {
        const current = await this.lockTrip(tx, tripId);
        if (!current || current.status !== 'ACTIVE') return;
        if (stopNotification) this.live.publishStop(tripId, stopNotification.type, stopNotification.data);
        this.live.publishLocation(tripId, {
          tripId, vehicleId: trip.vehicleId, ...e, recordedAt: at.toISOString(),
        });
      });

      return {
        eventId:
          e.eventId,
        disposition:
          'PROMOTED',
        accepted: true,
        duplicate: false,
        suspicious: false,
        promoted: true,
        rejectionReason:
          null,
      };
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.db.gpsIngestionEvent.findUnique(
            {
              where: {
                eventId:
                  e.eventId,
              },
              select: {
                status: true,
                rejectionReason:
                  true,
              },
            },
          );

        if (existing) {
          return this.duplicateResult(
            e.eventId,
            existing,
          );
        }
      }

      throw error;
    }
  }

  private async recordRejectedEvent(
    tripId: string,
    eventId: string,
    rejectionReason: string,
    disposition:
      | 'SUSPICIOUS'
      | 'TERMINAL_INVALID',
  ): Promise<IngestResult> {
    const expiresAt =
      new Date(
        Date.now() +
          this.gpsTtlHours() *
            3_600_000,
      );

    try {
      await this.db.gpsIngestionEvent.create({
        data: {
          eventId,
          tripId,
          status: 'REJECTED',
          rejectionReason,
          expiresAt,
        },
      });

      return {
        eventId,
        disposition,
        accepted: false,
        duplicate: false,
        suspicious:
          disposition ===
          'SUSPICIOUS',
        promoted: false,
        rejectionReason,
      };
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.db.gpsIngestionEvent.findUnique(
            {
              where: {
                eventId,
              },
              select: {
                status: true,
                rejectionReason:
                  true,
              },
            },
          );

        if (existing) {
          return this.duplicateResult(
            eventId,
            existing,
          );
        }
      }

      throw error;
    }
  }

  private duplicateResult(
    eventId: string,
    event: {
      status: string;
      rejectionReason:
        | string
        | null;
    },
  ): IngestResult {
    return {
      eventId,
      disposition:
        'DUPLICATE',
      accepted: true,
      duplicate: true,
      suspicious:
        event.status ===
        'REJECTED',
      promoted:
        event.status ===
        'PROMOTED',
      rejectionReason:
        event.rejectionReason,
    };
  }

  private gpsTtlHours() {
    const configured =
      Number(
        process.env
          .GPS_EVENT_DEDUPE_TTL_HOURS ??
          72,
      );

    return Number.isFinite(
      configured,
    )
      ? Math.min(
          168,
          Math.max(
            1,
            configured,
          ),
        )
      : 72;
  }

  private async cleanupGpsEvents() {
    const now =
      Date.now();

    if (
      now -
        this.lastGpsCleanupAt <
      300_000
    ) {
      return;
    }

    this.lastGpsCleanupAt =
      now;

    await this.db.gpsIngestionEvent.deleteMany(
      {
        where: {
          expiresAt: {
            lte: new Date(now),
          },
        },
      },
    );
  }

  private async lockTrip(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<{ id: string; driverId: string; status: string; lastPassedSequence: number }[]>`
      SELECT "id", "driverId", "status", "lastPassedSequence"
      FROM "trips" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
    return rows[0];
  }

  private async detectStops(tx: Prisma.TransactionClient, trip: any, e: Event) {
    const upcoming = trip.route.stops.filter((s: any) => s.sequence > trip.lastPassedSequence);
    for (const rs of upcoming.slice(0, 2)) {
      const distance = meters(e, rs.stop);
      const type = distance <= livePolicy.arrivedStopMeters ? 'STOP_ARRIVED'
        : distance <= livePolicy.approachingStopMeters ? 'STOP_APPROACHING' : null;
      if (!type) continue;
      await tx.tripEvent.upsert({
        where: { tripId_type_stopId: { tripId: trip.id, type, stopId: rs.stopId } },
        create: { tripId: trip.id, type, stopId: rs.stopId, sequence: rs.sequence,
          metadata: { distanceMeters: Math.round(distance) } }, update: {},
      });
      if (type === 'STOP_ARRIVED' && rs.sequence > 1) {
        await tx.trip.updateMany({
          where: { id: trip.id, status: 'ACTIVE', lastPassedSequence: { lt: rs.sequence - 1 } },
          data: { lastPassedSequence: rs.sequence - 1 },
        });
      }
      return { type, data: { stopId: rs.stopId, name: rs.stop.name,
        sequence: rs.sequence, distanceMeters: Math.round(distance) } };
    }
  }

  async ingestBatch(
    userId: string,
    tripId: string,
    events: Event[],
  ) {
    if (events.length > 500) {
      throw new BadRequestException(
        'Maximum 500 events',
      );
    }

    const trip =
      await this.ingestContext(
        userId,
        tripId,
      );

    const results:
      IngestResult[] =
      new Array(
        events.length,
      );

    const ordered =
      events
        .map(
          (
            event,
            index,
          ) => ({
            event,
            index,
          }),
        )
        .sort(
          (a, b) =>
            Date.parse(
              a.event
                .recordedAt,
            ) -
            Date.parse(
              b.event
                .recordedAt,
            ),
        );

    for (
      const {
        event,
        index,
      } of ordered
    ) {
      results[index] =
        await this.ingestActiveEvent(
          trip,
          tripId,
          event,
        );
    }

    return {
      results,
    };
  }

  async complete(
    userId: string,
    id: string,
  ) {
    const d =
      await this.driver(userId);

    const trip =
      await this.db.trip.findUnique({
        where: {
          id,
        },
      });

    if (
      !trip ||
      trip.driverId !== d.id
    ) {
      throw new ForbiddenException();
    }

    try {
      const ended =
        await this.db.$transaction(
          async tx => {
            const endedAt =
              this.lifecycle.now();

            const changed =
              await tx.trip.updateMany({
                where: {
                  id,
                  status: 'ACTIVE',
                },
                data: {
                  status:
                    'COMPLETED',
                  endedAt,
                },
              });

            if (changed.count !== 1) {
              throw this.completeConflict();
            }

            if (trip.scheduleId) {
              await tx.schedule.updateMany({
                where: {
                  id:
                    trip.scheduleId,
                  active: true,
                },
                data: {
                  active: false,
                },
              });
            }

            await tx.vehicleCurrentLocation.deleteMany(
              {
                where: {
                  tripId: id,
                },
              },
            );

            await tx.tripEvent.create({
              data: {
                tripId: id,
                type: 'COMPLETED',
              },
            });

            await tx.auditLog.create({
              data: {
                actorId:
                  userId,
                action:
                  'trip.completed',
                entityType:
                  'Trip',
                entityId: id,
              },
            });

            return tx.trip.findUniqueOrThrow(
              {
                where: {
                  id,
                },
              },
            );
          },
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
          },
        );

      this.live.publishEnded(id);

      return ended;
    } catch (error) {
      if (
        error instanceof
        ConflictException
      ) {
        throw error;
      }

      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        await this.db.trip.findUnique({
          where: {
            id,
          },
          select: {
            status: true,
          },
        });

        throw this.completeConflict();
      }

      throw error;
    }
  }

  private completeConflict() {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'TRIP_NOT_ACTIVE',
      message:
        'Only an active trip can complete.',
    });
  }
}
