import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { assertIsolatedValidation } from './validation-safety';

assertIsolatedValidation();
const db = new PrismaClient();
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function geography() {
  const rows=await db.$queryRaw<any[]>`SELECT ST_SRID(geog::geometry) AS srid, ST_X(geog::geometry) AS longitude, ST_Y(geog::geometry) AS latitude FROM "VehicleCurrentLocation" WHERE "tripId"=${id(71)}::uuid`;
  assert.deepEqual(rows[0],{srid:4326,longitude:124.8,latitude:10.01});
  const stops=await db.$queryRaw<any[]>`SELECT count(*)::int AS count, bool_and(ST_X(geog::geometry)=longitude AND ST_Y(geog::geometry)=latitude AND ST_SRID(geog::geometry)=4326) AS valid FROM "Stop"`;
  assert.ok(stops[0].count>=2);assert.equal(stops[0].valid,true);
  console.log('PASS stored PostGIS geography: current-location and stop coordinates/SRID match authoritative columns; timezone:',await db.$queryRawUnsafe('SHOW TimeZone'));
}
async function baseline() {
  const migrations = await db.$queryRaw<any[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  assert.equal(migrations.length, 5);
  assert.ok(!migrations.some(row => row.migration_name.includes('pilot_operations')));
  for (const [n, role] of [[1, 'DRIVER'], [2, 'DRIVER'], [3, 'ADMIN']] as const) {
    await db.$executeRaw`INSERT INTO "User" (id,email,"passwordHash",role,"updatedAt") VALUES (${id(n)}::uuid,${`migration-${n}@example.test`},'validation-hash',${role}::"Role",CURRENT_TIMESTAMP)`;
    if (role === 'DRIVER') await db.$executeRaw`INSERT INTO "Driver" (id,"userId","firstName","lastName") VALUES (${id(10+n)}::uuid,${id(n)}::uuid,'Migration','Fixture')`;
    await db.$executeRaw`INSERT INTO "RefreshSession" (id,"userId","tokenHash","expiresAt") VALUES (${id(20+n)}::uuid,${id(n)}::uuid,'validation-token-hash',CURRENT_TIMESTAMP + INTERVAL '1 day')`;
  }
  await db.$executeRaw`INSERT INTO "Route" (id,name,direction,"updatedAt") VALUES (${id(30)}::uuid,'Migration history','Outbound',CURRENT_TIMESTAMP)`;
  for (let n=1;n<=2;n++) {
    await db.$executeRaw`INSERT INTO "Stop" (id,name,latitude,longitude,"updatedAt") VALUES (${id(30+n)}::uuid,${`Historical stop ${n}`},${10+n/100},124.8,CURRENT_TIMESTAMP)`;
    await db.$executeRaw`INSERT INTO "RouteStop" (id,"routeId","stopId",sequence) VALUES (${id(40+n)}::uuid,${id(30)}::uuid,${id(30+n)}::uuid,${n})`;
    await db.$executeRaw`INSERT INTO "Vehicle" (id,type,"plateNumber","displayName",capacity,"assignedDriverId") VALUES (${id(50+n)}::uuid,'VAN',${`MIGRATION-${n}`},${`Historical vehicle ${n}`},15,${id(10+n)}::uuid)`;
    await db.$executeRaw`INSERT INTO "Schedule" (id,"routeId","driverId","vehicleId","departureAt") VALUES (${id(60+n)}::uuid,${id(30)}::uuid,${id(10+n)}::uuid,${id(50+n)}::uuid,CURRENT_TIMESTAMP)`;
    await db.$executeRaw`INSERT INTO "trips" (id,"scheduleId","routeId","driverId","vehicleId",status,"scheduledDepartureAt","startedAt") VALUES (${id(70+n)}::uuid,${id(60+n)}::uuid,${id(30)}::uuid,${id(10+n)}::uuid,${id(50+n)}::uuid,${n===1?'ACTIVE':'COMPLETED'}::"TripStatus",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
  }
  await db.$executeRaw`INSERT INTO "VehicleCurrentLocation" ("tripId","vehicleId",latitude,longitude,accuracy,"recordedAt","updatedAt") VALUES (${id(71)}::uuid,${id(51)}::uuid,10.01,124.8,5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
  console.log('PASS baseline: five migrations; two historical trips/schedules, location, driver/admin sessions');
}
async function verify() {
  const versions = await db.$queryRaw<any[]>`SELECT version() AS postgres, postgis_full_version() AS postgis, ST_SRID(ST_SetSRID(ST_MakePoint(124.8,10.01),4326)) AS srid, ST_Distance(ST_SetSRID(ST_MakePoint(124.8,10.01),4326)::geography,ST_SetSRID(ST_MakePoint(124.8,10.02),4326)::geography) AS meters`;
  assert.equal(versions[0].srid,4326); assert.ok(versions[0].meters>1000 && versions[0].meters<1200);
  console.log('PASS PostgreSQL/PostGIS connection and geography:', versions[0]);
  assert.equal(await db.schedule.count(),2); assert.equal(await db.trip.count(),2);
  for(const n of [1,2]) {
    const trip=await db.trip.findUniqueOrThrow({where:{id:id(70+n)},include:{vehicle:true,route:{include:{stops:true}}}});
    assert.equal(trip.status,n===1?'ACTIVE':'COMPLETED'); assert.equal(trip.scheduleId,id(60+n));
    assert.equal(trip.occupancyStatus,null); assert.equal(trip.occupancyUpdatedAt,null);
    assert.equal(trip.vehicle.conductionSticker,null); assert.equal(trip.vehicle.capacity,15); assert.equal(trip.route.stops.length,2);
    assert.ok((await db.refreshSession.findUniqueOrThrow({where:{id:id(20+n)}})).revokedAt);
  }
  assert.equal((await db.refreshSession.findUniqueOrThrow({where:{id:id(23)}})).revokedAt,null);
  assert.equal((await db.vehicleCurrentLocation.findUniqueOrThrow({where:{tripId:id(71)}})).latitude,10.01);
  await geography();
  assert.equal(await db.driverRouteAuthorization.count(),0); assert.equal(await db.driverDevice.count(),0);
  await assert.rejects(db.trip.create({data:{driverId:id(11),vehicleId:id(52),routeId:id(30),status:'ACTIVE'}}),{code:'P2002'});
  await assert.rejects(db.trip.create({data:{driverId:id(12),vehicleId:id(51),routeId:id(30),status:'ACTIVE'}}),{code:'P2002'});
  const trip=await db.trip.create({data:{driverId:id(12),vehicleId:id(52),routeId:id(30),status:'ACTIVE',startedAt:new Date(),occupancyStatus:'VACANT'}});
  assert.equal(trip.scheduleId,null); assert.equal(trip.scheduledDepartureAt,null);
  await db.driverRouteAuthorization.create({data:{driverId:id(12),routeId:id(30)}});
  await db.driverDevice.create({data:{driverId:id(12),credentialHash:'a'.repeat(64)}});
  await db.vehicle.update({where:{id:id(52)},data:{conductionSticker:'MIGRATION-OPTIONAL'}});
  await db.trip.update({where:{id:trip.id},data:{occupancyStatus:'FULL'}});
  assert.equal((await db.trip.findUniqueOrThrow({where:{id:trip.id}})).occupancyStatus,'FULL');
  assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:id(52)}})).capacity,15);
  const rows=await db.$queryRaw<any[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  assert.equal(rows.length,6); assert.equal(rows[5].migration_name,'202609180001_pilot_operations');
  // Preserve fixture history while releasing active constraints for subsequent API tests.
  await db.trip.updateMany({where:{status:'ACTIVE'},data:{status:'COMPLETED',endedAt:new Date()}});
  console.log('PASS migration: history/location preserved, null occupancy, only driver sessions revoked, route/device/sticker writes, unscheduled trips, both database uniqueness indexes');
}
(process.argv[2]==='baseline'?baseline():process.argv[2]==='verify'?verify():process.argv[2]==='geography'?geography():Promise.reject(new Error('Choose baseline, verify or geography')))
  .catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.$disconnect());
