import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertIsolatedValidation } from './validation-safety';
import { PrismaService } from '../src/common/prisma.service';
import { assertDatabaseUtc } from '../src/common/database-utc';
import { TripsService } from '../src/modules/trips/trips.service';
import { DriverComplianceService } from '../src/common/driver-compliance.service';
import { LiveService } from '../src/modules/live/live.service';
import { EtaService } from '../src/modules/live/eta.service';
import { locationFreshness } from '../src/common/live-policy';

assertIsolatedValidation();
const originalUrl = process.env.DATABASE_URL!;
const observers: PrismaClient[] = [];
let db: PrismaService | undefined;
let userId: string | undefined, vehicleId: string | undefined, routeId: string | undefined, tripId: string | undefined;
const stopIds: string[] = [];
const nearNow = (value: Date, label: string) => assert.ok(Math.abs(Date.now() - value.getTime()) < 15000, `${label} must be UTC now, not a shifted wall clock`);
async function main() {
  const baseline = new PrismaClient({ datasourceUrl: originalUrl }); observers.push(baseline);
  const [defaultSession] = await baseline.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone') AS timezone`;
  console.log(`Database default session timezone: ${defaultSession.timezone}`);
  // Test both a negative offset/DST zone and the operating region's positive offset.
  for (const timezone of ['America/Los_Angeles', 'Asia/Manila']) {
    const url = new URL(originalUrl);
    url.searchParams.set('options', `-c timezone=${timezone}`);
    url.searchParams.set('connection_limit', '5');
    const unguarded = new PrismaClient({ datasourceUrl: url.toString() }); observers.push(unguarded);
    const setting = await unguarded.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone') AS timezone`;
    assert.equal(setting[0].timezone, timezone);
    await assert.rejects(assertDatabaseUtc(unguarded), /Database session must use UTC/);
    process.env.DATABASE_URL = url.toString();
    db = new PrismaService(); await db.onModuleInit();
    // Concurrent held transactions require five distinct pooled server connections.
    const connections = await Promise.all(Array.from({ length: 5 }, () => db!.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number; timezone: string }>>`SELECT pg_backend_pid() AS pid, current_setting('TimeZone') AS timezone`;
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
      return row;
    })));
    assert.equal(new Set(connections.map(row => row.pid)).size, 5);
    connections.forEach(row => assert.equal(row.timezone, 'UTC'));
    await db.$disconnect(); await db.onModuleInit(); await db.assertUtc();
    console.log(`PASS ${timezone}: unguarded session rejected; five independent API pool connections and reconnect forced UTC`);
    await db.$disconnect(); db = undefined;
  }

  db = new PrismaService(); await db.onModuleInit();
  const tag = randomUUID();
  const user = await db.user.create({ data: { email: `utc-${tag}@example.test`, passwordHash: 'isolated-no-login', role: 'DRIVER', driver: { create: { firstName: 'UTC', lastName: 'Regression', active: true } } }, include: { driver: true } }); userId = user.id;
  const vehicle = await db.vehicle.create({ data: { displayName: 'UTC regression', plateNumber: `UTC-${tag}`, type: 'VAN', capacity: 15, assignedDriverId: user.driver!.id } }); vehicleId = vehicle.id;
  const route = await db.route.create({ data: { name: 'UTC regression', direction: 'Outbound' } }); routeId = route.id;
  for (let i = 0; i < 2; i++) {
    const stop = await db.stop.create({ data: { name: `UTC ${tag} ${i}`, latitude: 10 + i * .01, longitude: 124 } }); stopIds.push(stop.id);
    await db.routeStop.create({ data: { routeId, stopId: stop.id, sequence: i + 1, minutesFromPrevious: i ? 5 : null } });
  }
  const trip = await db.trip.create({ data: { routeId, vehicleId, driverId: user.driver!.id, status: 'ACTIVE', startedAt: new Date(Date.now() - 900000), occupancyStatus: 'VACANT' } }); tripId = trip.id;
  const published: any[] = [];
  const gateway: any = { publishLocation: (_id: string, event: any) => published.push(event), publishStop: () => {} };
  const service = new TripsService(db, gateway, new DriverComplianceService(), {} as any);
  const live = new LiveService(db, new EtaService());
  const at = new Date(Date.now() - 1000);
  // Equivalent +08:00 input must normalize to the same instant in all outputs.
  const offsetInput = new Date(at.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
  const event = { eventId: `${tag}-gps`, latitude: 10, longitude: 124, accuracy: 5, recordedAt: offsetInput };
  assert.equal((await service.ingest(userId, tripId, event)).promoted, true);
  const current = await db.vehicleCurrentLocation.findUniqueOrThrow({ where: { tripId } });
  assert.equal(current.recordedAt.toISOString(), at.toISOString()); nearNow(current.updatedAt, 'VehicleCurrentLocation.updatedAt');
  assert.equal((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).lastLocationAt!.toISOString(), at.toISOString());
  const ingestion = await db.gpsIngestionEvent.findUniqueOrThrow({ where: { eventId: event.eventId } }); nearNow(ingestion.receivedAt, 'GpsIngestionEvent.receivedAt');
  assert.ok(ingestion.expiresAt.getTime() > Date.now());
  const events = await db.tripEvent.findMany({ where: { tripId } }); assert.ok(events.length > 0); events.forEach(row => nearNow(row.createdAt, 'TripEvent.createdAt'));
  assert.equal(published[0].recordedAt, at.toISOString());
  assert.equal((await live.getLocation(tripId)).recordedAt.toISOString(), at.toISOString());
  assert.equal((await live.getLocation(tripId)).freshness, 'LIVE');
  assert.equal((await live.search(stopIds[0], stopIds[1])).find(row => row.tripId === tripId)!.boardingEta.status, 'AVAILABLE');
  assert.equal(locationFreshness(at, at.getTime() + 21000), 'STALE');
  assert.equal(locationFreshness(at, at.getTime() + 601000), 'OFFLINE');
  console.log('PASS GPS recordedAt, receivedAt, updatedAt, lastLocationAt, event time, offset normalization, realtime/public ISO, LIVE ETA and freshness aging');

  const batch = [2, 1].map(i => ({ ...event, eventId: `${tag}-batch-${i}`, recordedAt: new Date(at.getTime() + i * 1000).toISOString() }));
  const result = await service.ingestBatch(userId, tripId, batch); assert.ok(result.results.every(row => row.promoted));
  assert.equal((await db.vehicleCurrentLocation.findUniqueOrThrow({ where: { tripId } })).recordedAt.toISOString(), batch[0].recordedAt);
  assert.equal((await service.ingest(userId, tripId, batch[0])).duplicate, true);
  assert.equal((await service.ingest(userId, tripId, { ...event, eventId: `${tag}-stale`, recordedAt: new Date(at.getTime() - 1000).toISOString() })).disposition, 'STALE');
  assert.equal((await service.ingest(userId, tripId, { ...event, eventId: `${tag}-invalid`, recordedAt: new Date(Date.now() + 600000).toISOString() })).disposition, 'TERMINAL_INVALID');
  nearNow((await db.gpsIngestionEvent.findUniqueOrThrow({ where: { eventId: `${tag}-invalid` } })).receivedAt, 'Rejected receivedAt');
  assert.equal((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).lastLocationAt!.toISOString(), batch[0].recordedAt);
  console.log('PASS offline batch ordering, monotonic promotion, duplicate/stale/future handling and rejected-event receipt time');
  await db.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Manila'`;
    await assert.rejects(assertDatabaseUtc(tx), /Database session must use UTC/);
  });
  console.log('PASS guard detects deliberate session drift');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (db) {
    if (tripId) await db.trip.delete({ where: { id: tripId } });
    if (vehicleId) await db.vehicle.delete({ where: { id: vehicleId } });
    if (routeId) await db.route.delete({ where: { id: routeId } });
    for (const id of stopIds) await db.stop.delete({ where: { id } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
  await Promise.all(observers.map(client => client.$disconnect()));
  process.env.DATABASE_URL = originalUrl;
});
