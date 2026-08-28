import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = process.env.SUGAT_E2E_ROOT!;
const passengerRequire = createRequire(`${root}/apps/passenger-web/package.json`);
const { io } = passengerRequire('socket.io-client') as { io: (...args: any[]) => any };
const db = new PrismaClient();
const resultFile = process.env.SUGAT_E2E_RESULT_FILE!;
const apiPid = Number(process.env.SUGAT_E2E_API_PID);
const apiLog = process.env.SUGAT_E2E_API_LOG!;
const base = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const api = `${base}/api/v1`;
const tag = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `E2e-${randomUUID()}!`;
const results: Record<string, 'PASS' | 'FAIL'> = {
  validGps: 'FAIL', gpsQuarantine: 'FAIL', passengerRealtime: 'FAIL', adminRealtime: 'FAIL',
  reconnect: 'FAIL', redisOutage: 'FAIL', concurrentCompletion: 'FAIL', passengerE2e: 'FAIL', adminE2e: 'FAIL',
};
const ids: { user?: string; driver?: string; vehicle?: string; route?: string; stops: string[]; trips: string[] } = { stops: [], trips: [] };
let redisStopped = false;

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function processAlive() { try { process.kill(apiPid, 0); return true; } catch { return false; } }
function compose(...args: string[]) {
  const out = spawnSync('docker', ['compose', '--env-file', `${root}/.env.e2e.local`, '-f', `${root}/docker-compose.e2e.yml`, ...args], { cwd: root, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`Docker Compose ${args.join(' ')} failed: ${(out.stderr || out.stdout).trim()}`);
  return out.stdout;
}
function redisHealthy() {
  const id = compose('ps', '-q', 'redis').trim(); if (!id) return false;
  const out = spawnSync('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', id], { encoding: 'utf8' });
  return out.status === 0 && out.stdout.trim() === 'healthy';
}
async function request(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const text = await response.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}
async function login(email: string, loginPassword: string) {
  const r = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: loginPassword }) });
  assert(r.status === 201 && r.body?.accessToken, `Login failed for ${email}: HTTP ${r.status}`);
  return r.body.accessToken as string;
}
async function connectSocket(token?: string) {
  const socket = io(`${base}/live`, { transports: ['websocket'], forceNew: true, ...(token ? { auth: { token } } : {}) });
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 8000); socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('connect_error', reject); });
  return socket;
}
async function subscribe(socket: any, event: string, body?: any) {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 5000); socket.emit(event, body, () => { clearTimeout(timer); resolve(); }); setTimeout(() => { clearTimeout(timer); resolve(); }, 300); });
}
async function createReadyTrip() {
  const trip = await db.trip.create({ data: { routeId: ids.route!, driverId: ids.driver!, vehicleId: ids.vehicle!, status: 'READY', scheduledDepartureAt: new Date() } });
  ids.trips.push(trip.id); return trip.id;
}
async function startTrip(tripId: string, driverToken: string) {
  const r = await request(`/driver/trips/${tripId}/start`, { method: 'POST' }, driverToken);
  assert(r.status === 201 && r.body?.status === 'ACTIVE', `Trip start failed: HTTP ${r.status}`);
}
async function gps(tripId: string, driverToken: string, point: Record<string, unknown>) {
  return request(`/driver/trips/${tripId}/locations`, { method: 'POST', body: JSON.stringify(point) }, driverToken);
}
function point(offsetSeconds: number, overrides: Record<string, unknown> = {}) {
  return { eventId: `${tag}-${randomUUID()}`, latitude: 10.7001, longitude: 124.8001, accuracy: 8, speed: 8, heading: 90, recordedAt: new Date(Date.now() + offsetSeconds * 1000).toISOString(), ...overrides };
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 12000) {
  const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await sleep(200); } throw new Error(`${label} timed out`);
}

async function main() {
  assert(root && resultFile && apiLog && Number.isInteger(apiPid), 'Runner environment is incomplete');
  const email = `${tag}@example.test`;
  const user = await db.user.create({ data: { email, passwordHash: await argon2.hash(password), role: 'DRIVER', driver: { create: { firstName: 'Final', lastName: 'Gate', active: true, licenseNumber: tag, licenseExpiresAt: new Date(Date.now() + 365 * 86400000), identityVerificationStatus: 'APPROVED', licenseVerificationStatus: 'APPROVED' } } }, include: { driver: true } });
  ids.user = user.id; ids.driver = user.driver!.id;
  const vehicle = await db.vehicle.create({ data: { type: 'VAN', plateNumber: tag, displayName: `E2E ${tag}`, active: true, assignedDriverId: ids.driver } }); ids.vehicle = vehicle.id;
  for (const [i, coordinates] of [[0, [10.7000, 124.8000]], [1, [10.7100, 124.8100]], [2, [10.7200, 124.8200]]] as const) {
    const stop = await db.stop.create({ data: { name: `${tag}-stop-${i + 1}`, cityMunicipality: 'E2E', province: 'E2E', latitude: coordinates[0], longitude: coordinates[1] } }); ids.stops.push(stop.id);
  }
  const route = await db.route.create({ data: { name: tag, direction: 'E2E ORDER', stops: { create: ids.stops.map((stopId, index) => ({ stopId, sequence: index + 1 })) } } }); ids.route = route.id;
  const driverToken = await login(email, password);
  const adminToken = await login('admin@example.test', 'DevelopmentOnly123!');
  let passenger = await connectSocket(); let admin = await connectSocket(adminToken);
  const passengerLocations: any[] = [], passengerCompleted: any[] = [], adminStarted: any[] = [], adminLocations: any[] = [], adminCompleted: any[] = [];
  const bindPassenger = () => { passenger.on('trip.location.updated', (v: any) => passengerLocations.push(v)); passenger.on('trip.completed', (v: any) => passengerCompleted.push(v)); };
  const bindAdmin = () => { admin.on('trip.started', (v: any) => adminStarted.push(v)); admin.on('trip.location.updated', (v: any) => adminLocations.push(v)); admin.on('trip.completed', (v: any) => adminCompleted.push(v)); };
  bindPassenger(); bindAdmin(); await subscribe(admin, 'admin.subscribe');

  const tripId = await createReadyTrip(); await subscribe(passenger, 'trip.subscribe', { tripId });
  const before = await request(`/public/trips/search?fromStopId=${ids.stops[0]}&toStopId=${ids.stops[2]}`);
  assert(before.status === 200 && !before.body.some((x: any) => x.tripId === tripId), 'Trip was public before trusted GPS');
  await startTrip(tripId, driverToken); await waitFor(() => adminStarted.filter(x => x.tripId === tripId).length === 1, 'trip.started');

  const baseline = point(0); const baselineResponse = await gps(tripId, driverToken, baseline);
  assert(baselineResponse.status === 201 && baselineResponse.body?.promoted === true, 'Trusted GPS was not accepted');
  await waitFor(() => passengerLocations.length === 1 && adminLocations.length === 1, 'baseline realtime');
  const [history, current, trip] = await Promise.all([db.tripLocationHistory.findUnique({ where: { eventId: baseline.eventId as string } }), db.vehicleCurrentLocation.findUnique({ where: { tripId } }), db.trip.findUnique({ where: { id: tripId } })]);
  assert(history && !history.suspicious && current && current.latitude === baseline.latitude && trip?.lastLocationAt, 'Trusted GPS persistence mismatch');
  assert(!('eventId' in current), 'eventId leaked into VehicleCurrentLocation');
  const visible = await request(`/public/trips/search?fromStopId=${ids.stops[0]}&toStopId=${ids.stops[2]}`);
  assert(visible.status === 200 && visible.body.some((x: any) => x.tripId === tripId), 'Trip was not visible after trusted GPS');
  results.validGps = 'PASS';

  const lastTrustedAt = trip.lastLocationAt!.getTime(); const inaccurate = point(10, { accuracy: 300 });
  const stopEventsBeforeSuspicious = await db.tripEvent.count({ where: { tripId, type: { in: ['STOP_APPROACHING', 'STOP_ARRIVED', 'STOP_PASSED'] } } });
  const impossible = point(20, { latitude: 12.0, longitude: 126.0, speed: 100 });
  assert((await gps(tripId, driverToken, inaccurate)).body?.rejectionReason === 'ACCURACY_EXCEEDS_200_METERS', 'Inaccurate GPS was not quarantined');
  assert((await gps(tripId, driverToken, impossible)).body?.rejectionReason === 'IMPOSSIBLE_SPEED', 'Impossible-speed GPS was not quarantined');
  const duplicate = await gps(tripId, driverToken, impossible); assert(duplicate.body?.duplicate === true && duplicate.body?.suspicious === true, 'Suspicious GPS was not idempotent');
  const quarantined = await db.tripLocationHistory.findMany({ where: { eventId: { in: [inaccurate.eventId as string, impossible.eventId as string] } } });
  const afterSuspicious = await db.trip.findUniqueOrThrow({ where: { id: tripId }, include: { currentLocation: true } });
  assert(quarantined.length === 2 && quarantined.every(x => x.suspicious && x.rejectionReason), 'Suspicious history rows missing');
  assert(afterSuspicious.lastLocationAt!.getTime() === lastTrustedAt && afterSuspicious.currentLocation!.latitude === baseline.latitude, 'Suspicious GPS replaced trusted state');
  assert(passengerLocations.length === 1 && adminLocations.length === 1, 'Suspicious GPS published realtime');
  assert(await db.tripEvent.count({ where: { tripId, type: { in: ['STOP_APPROACHING', 'STOP_ARRIVED', 'STOP_PASSED'] } } }) === stopEventsBeforeSuspicious, 'Suspicious GPS triggered stop detection');
  const recovery = point(30, { latitude: 10.7002, longitude: 124.8002 }); assert((await gps(tripId, driverToken, recovery)).body?.promoted, 'Recovery GPS not promoted');
  await waitFor(() => passengerLocations.length === 2 && adminLocations.length === 2, 'recovery realtime');
  results.gpsQuarantine = 'PASS';
  const publicKeys = Object.keys(passengerLocations[0]);
  assert(['driver', 'compliance', 'user', 'verification', 'licenseNumber'].every(key => !publicKeys.includes(key)), 'Public realtime payload contains internal/admin fields');
  assert(passengerLocations[0].tripId === tripId && passengerLocations[0].latitude === baseline.latitude, 'Passenger realtime payload mismatch');
  results.passengerRealtime = 'PASS'; results.adminRealtime = 'PASS';

  passenger.disconnect(); admin.disconnect(); const disconnected = point(40, { latitude: 10.7003, longitude: 124.8003 }); assert((await gps(tripId, driverToken, disconnected)).body?.promoted, 'Disconnected GPS failed');
  passenger = await connectSocket(); admin = await connectSocket(adminToken); bindPassenger(); bindAdmin(); await subscribe(passenger, 'trip.subscribe', { tripId }); await subscribe(admin, 'admin.subscribe');
  const [publicLocation, adminLive] = await Promise.all([request(`/public/trips/${tripId}/location`), request('/admin/live', {}, adminToken)]);
  assert(publicLocation.status === 200 && publicLocation.body.latitude === disconnected.latitude, 'Passenger HTTP resync mismatch');
  assert(adminLive.status === 200 && adminLive.body.find((x: any) => x.id === tripId)?.currentLocation?.latitude === disconnected.latitude, 'Admin HTTP resync mismatch');
  results.reconnect = 'PASS';

  const pidBefore = apiPid; compose('stop', 'redis'); redisStopped = true; await sleep(2500);
  const outage = point(50, { latitude: 10.7004, longitude: 124.8004 }); const outageResponse = await gps(tripId, driverToken, outage);
  assert(outageResponse.status === 201 && outageResponse.body?.promoted && processAlive() && apiPid === pidBefore, 'API/GPS failed during Redis outage');
  const outageDb = await db.trip.findUniqueOrThrow({ where: { id: tripId }, include: { currentLocation: true, locationHistory: { where: { eventId: outage.eventId as string } } } });
  assert(outageDb.locationHistory.length === 1 && outageDb.currentLocation?.latitude === outage.latitude && outageDb.lastLocationAt, 'PostgreSQL did not persist outage GPS');
  const [outagePublic, outageAdmin] = await Promise.all([request(`/public/trips/${tripId}/location`), request('/admin/live', {}, adminToken)]);
  assert(outagePublic.status === 200 && outagePublic.body.latitude === outage.latitude, 'Passenger HTTP unavailable during outage');
  assert(outageAdmin.status === 200 && outageAdmin.body.find((x: any) => x.id === tripId)?.currentLocation?.latitude === outage.latitude, 'Admin HTTP unavailable during outage');
  compose('start', 'redis'); redisStopped = false;
  await waitFor(redisHealthy, 'Redis health recovery', 30000); await sleep(3000);
  const passengerBeforeRecovery = passengerLocations.length, adminBeforeRecovery = adminLocations.length;
  const recovered = point(60, { latitude: 10.7005, longitude: 124.8005 }); assert((await gps(tripId, driverToken, recovered)).body?.promoted, 'Post-recovery GPS failed');
  await waitFor(() => passengerLocations.length === passengerBeforeRecovery + 1 && adminLocations.length === adminBeforeRecovery + 1, 'recovered realtime');
  assert(processAlive() && apiPid === pidBefore, 'API restarted or died across outage');
  const log = await readFile(apiLog, 'utf8');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) { const secret = process.env[key]; assert(!secret || !log.includes(secret), `${key} leaked to API log`); }
  assert(!/unhandled rejection|MaxRetriesPerRequestError/i.test(log), 'Unhandled Redis failure logged during outage');
  assert(/Redis adapter unavailable/.test(log) && /Redis adapter recovered/.test(log), 'Safe Redis degradation/recovery lifecycle was not logged');
  console.log('API survived outage: YES'); console.log('PostgreSQL persistence during outage: YES'); console.log('Passenger HTTP state available: YES'); console.log('Admin HTTP state available: YES'); console.log('Redis recovered without API restart: YES'); console.log('Passenger realtime recovered: YES'); console.log('Admin realtime recovered: YES');
  results.redisOutage = 'PASS';

  const raceRows: string[] = []; let passengerCompletionBaseline = passengerCompleted.length;
  for (let run = 1; run <= 3; run++) {
    const raceTrip = run === 1 ? tripId : await createReadyTrip();
    if (run > 1) await startTrip(raceTrip, driverToken);
    const adminBaseline = adminCompleted.length;
    const responses = await Promise.all([request(`/driver/trips/${raceTrip}/complete`, { method: 'POST' }, driverToken), request(`/driver/trips/${raceTrip}/complete`, { method: 'POST' }, driverToken)]);
    const winner = responses.findIndex(x => x.status === 201); const loser = responses[1 - winner];
    assert(winner >= 0 && loser?.status === 409 && loser.body?.code === 'TRIP_NOT_ACTIVE' && loser.body?.message === 'Only an active trip can complete.', `Completion race ${run} contract failed: ${responses.map(x => x.status).join('/')}`);
    assert(!JSON.stringify(loser.body).match(/P2034|PrismaClient|serialization/i), `Completion race ${run} leaked database internals`);
    await waitFor(() => adminCompleted.length === adminBaseline + 1, `completion event ${run}`);
    const final = await db.trip.findUniqueOrThrow({ where: { id: raceTrip } }); assert(final.status === 'COMPLETED' && final.endedAt, `Completion race ${run} DB state invalid`);
    raceRows.push(`${run} | request ${winner + 1} | HTTP 409 TRIP_NOT_ACTIVE | COMPLETED | 1`);
  }
  await waitFor(() => passengerCompleted.length === passengerCompletionBaseline + 1, 'passenger completion');
  console.log('Run | Winner | Loser Response | Final DB State | Completion Events'); raceRows.forEach(row => console.log(row));
  results.concurrentCompletion = 'PASS';

  const stops = await request('/public/stops'); const routes = await request('/public/routes');
  assert(stops.status === 200 && ids.stops.every(id => stops.body.some((x: any) => x.id === id)), 'Passenger stops contract failed');
  const publicRoute = routes.body.find((x: any) => x.id === ids.route); assert(publicRoute && publicRoute.stops.map((x: any) => x.sequence).join(',') === '1,2,3', 'Passenger route order failed');
  const afterCompletion = await request(`/public/trips/search?fromStopId=${ids.stops[0]}&toStopId=${ids.stops[2]}`);
  assert(!afterCompletion.body.some((x: any) => x.tripId === tripId) && (await request(`/public/trips/${tripId}/location`)).status === 404, 'Completed trip remained public');
  results.passengerE2e = 'PASS';
  const finalAdminLive = await request('/admin/live', {}, adminToken); assert(finalAdminLive.status === 200 && !finalAdminLive.body.some((x: any) => ids.trips.includes(x.id)), 'Completed E2E trips remained in admin live state');
  assert(adminStarted.length === 3 && adminCompleted.filter(x => ids.trips.includes(x.tripId)).length === 3, 'Admin event counts mismatch');
  results.adminE2e = 'PASS'; passenger.disconnect(); admin.disconnect();
}

async function cleanup() {
  if (redisStopped) { try { compose('start', 'redis'); } catch {} }
  try {
    if (ids.trips.length) await db.trip.deleteMany({ where: { id: { in: ids.trips } } });
    if (ids.route) await db.route.delete({ where: { id: ids.route } }).catch(() => undefined);
    if (ids.stops.length) await db.stop.deleteMany({ where: { id: { in: ids.stops } } });
    if (ids.vehicle) await db.vehicle.delete({ where: { id: ids.vehicle } }).catch(() => undefined);
    if (ids.user) { await db.auditLog.deleteMany({ where: { actorId: ids.user } }); await db.user.delete({ where: { id: ids.user } }).catch(() => undefined); }
  } finally { await db.$disconnect(); await writeFile(resultFile, JSON.stringify(results)); }
}

main().catch(error => { console.error(`E2E gate failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }).finally(cleanup);
