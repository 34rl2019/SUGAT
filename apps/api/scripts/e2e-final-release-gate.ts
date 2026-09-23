import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { createRequire } from 'node:module';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { assertIsolatedValidation } from './validation-safety';

assertIsolatedValidation(true);

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
  validGps: 'FAIL', duplicateGps: 'FAIL', outOfOrderGps: 'FAIL', offlineBatch: 'FAIL', stopProgression: 'FAIL',
  gpsQuarantine: 'FAIL', passengerRealtime: 'FAIL', adminRealtime: 'FAIL',
  realtimeSecurity: 'FAIL', tripLifecycle: 'FAIL', reconnect: 'FAIL', redisOutage: 'FAIL', passengerEta: 'FAIL', concurrentCompletion: 'FAIL', passengerE2e: 'FAIL', adminE2e: 'FAIL', securityE2e: 'FAIL',
  pilotOperations: 'FAIL', pilotOverview: 'FAIL', pilotDeviceReset: 'FAIL',
};
const ids: { user?: string; driver?: string; vehicle?: string; route?: string; stops: string[]; trips: string[]; schedules: string[] } = { stops: [], trips: [], schedules: [] };
const securityUsers: string[] = [];
const securityVehicles: string[] = [];
const securityStorageKeys: string[] = [];
let redisStopped = false;
const openSockets: any[] = [];

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function storageFileCount() { try { return (await readdir(process.env.DRIVER_DOCUMENT_STORAGE_DIR!)).length; } catch (error: any) { if (error?.code === 'ENOENT') return 0; throw error; } }
function processAlive() { try { process.kill(apiPid, 0); return true; } catch { return false; } }
function compose(...args: string[]) {
  // Optional portable-process control for Windows validation, never application code.
  if (process.env.SUGAT_E2E_REDIS_CONTROL) {
    assert(args.length===2 && ['start','stop'].includes(args[0]) && args[1]==='redis','Unsupported portable Redis operation');
    const out=spawnSync(process.execPath,[process.env.SUGAT_E2E_REDIS_CONTROL,args[0]],{encoding:'utf8',windowsHide:true});
    if(out.status!==0)throw new Error(`Portable Redis ${args[0]} failed: ${out.stderr}`);
    return out.stdout;
  }
  const out = spawnSync('docker', ['compose', '--env-file', `${root}/.env.e2e.local`, '-f', `${root}/docker-compose.e2e.yml`, ...args], { cwd: root, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`Docker Compose ${args.join(' ')} failed: ${(out.stderr || out.stdout).trim()}`);
  return out.stdout;
}
async function redisHealthy() {
  if(process.env.SUGAT_E2E_REDIS_CONTROL){const client=new Redis(process.env.REDIS_URL!,{lazyConnect:true,retryStrategy:()=>null,connectTimeout:1000});client.on('error',()=>{});try{await client.connect();return await client.ping()==='PONG'}catch{return false}finally{client.disconnect()}}
  const id = compose('ps', '-q', 'redis').trim(); if (!id) return false;
  const out = spawnSync('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', id], { encoding: 'utf8' });
  return out.status === 0 && out.stdout.trim() === 'healthy';
}
const deviceByEmail=new Map<string,string>(),deviceByToken=new Map<string,string>();
async function request(path: string, init: RequestInit = {}, token?: string) {
  let sent:any=null;try{sent=typeof init.body==='string'?JSON.parse(init.body):null}catch{}
  const credential=(token?deviceByToken.get(token):undefined)??(sent?.refreshToken?deviceByToken.get(sent.refreshToken):undefined)??(sent?.email?deviceByEmail.get(sent.email):undefined);
  if(sent&&(path==='/auth/login'||path==='/auth/refresh')&&!Object.prototype.hasOwnProperty.call(sent,'deviceCredential'))init={...init,body:JSON.stringify({...sent,...(credential?{deviceCredential:credential}:{})})};
  init={...init,headers:{...(credential?{'x-sugat-device-credential':credential}:{}),...init.headers}};
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const text = await response.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if(response.ok&&body?.accessToken){const key=body.deviceCredential??credential;if(key){deviceByToken.set(body.accessToken,key);deviceByToken.set(body.refreshToken,key);if(sent?.email)deviceByEmail.set(sent.email,key)}}
  return { status: response.status, body };
}
async function login(email: string, loginPassword: string, forwardedFor: string) {
  const r = await request('/auth/login', { method: 'POST', headers: { 'x-forwarded-for': forwardedFor }, body: JSON.stringify({ email, password: loginPassword }) });
  assert(r.status === 201 && r.body?.accessToken, `Login failed for ${email}: HTTP ${r.status}`);
  return r.body.accessToken as string;
}
// Historical schedule fixtures exist only in this guarded disposable database runner.
async function legacySchedule(body: string) {
  const {routeId, driverId, vehicleId, departureAt:iso}=JSON.parse(body);
  const departureAt=new Date(iso),status=departureAt.getTime()-Date.now()<=3600000?'READY':'SCHEDULED';
  const schedule=await db.schedule.create({data:{routeId,driverId,vehicleId,departureAt,
    trip:{create:{routeId,driverId,vehicleId,scheduledDepartureAt:departureAt,status}}},include:{trip:true}});
  return {status:201,body:schedule};
}
async function securityChecks(adminToken: string) {
  const authHeaders = (ip: string, extra: Record<string, string> = {}) => ({ 'x-forwarded-for': ip, ...extra });
  const loginSession = async (email: string, loginPassword: string, ip: string) => request('/auth/login', { method: 'POST', headers: authHeaders(ip), body: JSON.stringify({ email, password: loginPassword }) });
  const securityEmail = `${tag}-security@example.test`, oldPassword = `Old-${randomUUID()}!`, newPassword = `New-${randomUUID()}!`;
  const securityUser = await db.user.create({ data: { email: securityEmail, passwordHash: await argon2.hash(oldPassword), role: 'DRIVER', driver: { create: { firstName: 'Security', lastName: 'Session', active: true } } } });
  securityUsers.push(securityUser.id);
  assert((await loginSession(securityEmail, 'invalid-password', '198.51.100.10')).status === 401, 'Invalid login was accepted');
  const first = await loginSession(securityEmail, oldPassword, '198.51.100.11'), second = await loginSession(securityEmail, oldPassword, '198.51.100.12');
  assert(first.status === 201 && second.status === 201, 'Multiple session login failed');
  const rotated = await request('/auth/refresh', { method: 'POST', headers: authHeaders('198.51.100.13'), body: JSON.stringify({ refreshToken: first.body.refreshToken }) });
  assert(rotated.status === 201 && (await request('/auth/refresh', { method: 'POST', headers: authHeaders('198.51.100.14'), body: JSON.stringify({ refreshToken: first.body.refreshToken }) })).status === 401, 'Refresh replay protection failed');
  assert((await request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rotated.body.refreshToken }) }, rotated.body.accessToken)).status === 201, 'Logout failed');
  assert((await request('/auth/refresh', { method: 'POST', headers: authHeaders('198.51.100.15'), body: JSON.stringify({ refreshToken: rotated.body.refreshToken }) })).status === 401, 'Logout did not revoke refresh session');
  const third = await loginSession(securityEmail, oldPassword, '198.51.100.16'), fourth = await loginSession(securityEmail, oldPassword, '198.51.100.17');
  assert((await request('/auth/logout-all', { method: 'POST' }, third.body.accessToken)).status === 201, 'Logout-all failed');
  for (const session of [third, fourth]) assert((await request('/auth/refresh', { method: 'POST', headers: authHeaders(`198.51.100.${18 + Math.random()}`), body: JSON.stringify({ refreshToken: session.body.refreshToken }) })).status === 401, 'Logout-all left an active session');

  const cookieLogin = await fetch(`${api}/auth/login`, { method: 'POST', headers: authHeaders('198.51.100.20', { 'content-type': 'application/json', 'x-sugat-client': 'admin-web' }), body: JSON.stringify({ email: 'admin@example.test', password: 'DevelopmentOnly123!' }) });
  const setCookie = cookieLogin.headers.get('set-cookie') ?? '', cookie = setCookie.split(';')[0]; const cookieBody: any = await cookieLogin.json();
  assert(cookieLogin.status === 201 && cookie && !cookieBody.refreshToken && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Path=\/api\/v1\/auth/i.test(setCookie) && /Max-Age=/i.test(setCookie), 'Admin Web cookie attributes are invalid');
  const cookieRefresh = await fetch(`${api}/auth/refresh`, { method: 'POST', headers: authHeaders('198.51.100.21', { 'content-type': 'application/json', 'x-sugat-client': 'admin-web', cookie }), body: '{}' });
  const rotatedCookie = (cookieRefresh.headers.get('set-cookie') ?? '').split(';')[0]; const cookieRefreshBody: any = await cookieRefresh.json();
  assert(cookieRefresh.status === 201 && rotatedCookie && !cookieRefreshBody.refreshToken, 'Cookie refresh failed');
  const cookieLogout = await fetch(`${api}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sugat-client': 'admin-web', cookie: rotatedCookie, authorization: `Bearer ${cookieRefreshBody.accessToken}` }, body: '{}' });
  assert(cookieLogout.status === 201 && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cookieLogout.headers.get('set-cookie') ?? ''), 'Cookie logout did not clear the cookie');

  const adminPolicyEmail = `${tag}-admin-policy@example.test`;
  const adminPolicyUser = await db.user.create({ data: { email: adminPolicyEmail, passwordHash: await argon2.hash(oldPassword), role: 'ADMIN', mustChangePassword: true } });
  securityUsers.push(adminPolicyUser.id);
  const adminPolicyLogin = await loginSession(adminPolicyEmail, oldPassword, '198.51.100.26');
  assert(adminPolicyLogin.status === 201 && adminPolicyLogin.body.mustChangePassword === false, 'Driver-only temporary-password policy leaked into an admin session');
  assert((await request('/admin/dashboard', {}, adminPolicyLogin.body.accessToken)).status === 200, 'Administrator was blocked by a driver-only temporary-password flag');

  const temporaryEmail = `${tag}-temporary@example.test`, temporaryPassword = `Temporary-${randomUUID()}!`, permanentPassword = `Permanent-${randomUUID()}!`;
  const created = await request('/admin/drivers', { method: 'POST', body: JSON.stringify({ email: temporaryEmail, password: temporaryPassword, firstName: 'Temporary', lastName: 'Driver', licenseNumber: `${tag}-license`, licenseExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString() }) }, adminToken);
  assert(created.status === 201, `Temporary driver creation failed: HTTP ${created.status}`);
  const temporaryUser = await db.user.findUniqueOrThrow({ where: { email: temporaryEmail }, include: { driver: true } }); securityUsers.push(temporaryUser.id);
  const temporaryLogin = await loginSession(temporaryEmail, temporaryPassword, '198.51.100.22');
  assert(temporaryLogin.status === 201 && temporaryLogin.body.mustChangePassword === true, 'Temporary state was not returned at login');
  assert((await request('/driver/assignment', {}, temporaryLogin.body.accessToken)).status === 403, 'Temporary account accessed protected driver operations');
  const changed = await request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: permanentPassword }) }, temporaryLogin.body.accessToken);
  assert(changed.status === 201 && changed.body.mustChangePassword === false, 'Temporary password change failed');
  assert((await request('/auth/refresh', { method: 'POST', headers: authHeaders('198.51.100.23'), body: JSON.stringify({ refreshToken: temporaryLogin.body.refreshToken }) })).status === 401, 'Password change did not revoke the prior session');
  assert((await loginSession(temporaryEmail, temporaryPassword, '198.51.100.24')).status === 401, 'Old temporary password remained valid');
  const permanentLogin = await loginSession(temporaryEmail, permanentPassword, '198.51.100.25');
  assert(permanentLogin.status === 201 && (await request('/driver/assignment', {}, permanentLogin.body.accessToken)).status === 200, 'Driver access was not restored after password change');

  const jpeg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' });
  const form = (entries: Array<[string, Blob]>) => { const data = new FormData(); for (const [name, value] of entries) data.append(name, value, `${name}.jpg`); return data; };
  assert((await request('/driver/verification/submissions', { method: 'POST', body: form([['unexpected', jpeg]]) }, permanentLogin.body.accessToken)).status === 400, 'Unexpected upload field was accepted');
  const invalid = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/jpeg' });
  const beforeFiles = await storageFileCount();
  assert((await request('/driver/verification/submissions', { method: 'POST', body: form([['licenseFront', jpeg], ['licenseBack', invalid], ['selfie', jpeg]]) }, permanentLogin.body.accessToken)).status === 400, 'Invalid signature was accepted');
  assert(await storageFileCount() === beforeFiles, 'Partial upload left a private file behind');
  const oversized = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' });
  assert((await request('/driver/verification/submissions', { method: 'POST', body: form([['licenseFront', oversized], ['licenseBack', jpeg], ['selfie', jpeg]]) }, permanentLogin.body.accessToken)).status === 413, 'Oversized upload was accepted');
  assert((await request('/driver/verification/submissions', { method: 'POST', body: form([['licenseFront', jpeg], ['licenseBack', jpeg], ['selfie', jpeg]]) })).status === 401, 'Unauthorized upload was accepted');
  const valid = await request('/driver/verification/submissions', { method: 'POST', body: form([['licenseFront', jpeg], ['licenseBack', jpeg], ['selfie', jpeg]]) }, permanentLogin.body.accessToken);
  assert(valid.status === 201, `Valid verification upload failed: HTTP ${valid.status} ${JSON.stringify(valid.body)}`);
  const documents = await db.driverVerificationDocument.findMany({ where: { submission: { driverId: temporaryUser.driver!.id } }, select: { storageKey: true } }); securityStorageKeys.push(...documents.map(item => item.storageKey));

  let throttled = false;
  for (let attempt = 0; attempt < 7; attempt++) { const response = await loginSession(`${tag}-rate@example.test`, 'invalid-password', '198.51.100.30'); if (response.status === 429) { throttled = true; break; } assert(response.status === 401, `Unexpected rate-limit pre-threshold status ${response.status}`); }
  assert(throttled, 'Rapid login attempts did not return HTTP 429');
  results.securityE2e = 'PASS';
}
async function connectSocket(token?: string) {
  const socket = io(`${base}/live`, { transports: ['websocket'], forceNew: true, ...(token ? { auth: { token } } : {}) });
  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 8000); socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('connect_error', reject); });
  return socket;
}
async function subscribe(socket: any, event: string, body?: any) {
  return new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 5000); const acknowledge = (value: any) => { clearTimeout(timer); resolve(value); }; body === undefined ? socket.emit(event, acknowledge) : socket.emit(event, body, acknowledge); });
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
  for (const [i, coordinates] of [[0, [10.7000, 124.8000]], [1, [10.7100, 124.8100]], [2, [10.7200, 124.8200]], [3, [10.7300, 124.8300]]] as const) {
    const stop = await db.stop.create({ data: { name: `${tag}-stop-${i + 1}`, cityMunicipality: 'E2E', province: 'E2E', latitude: coordinates[0], longitude: coordinates[1] } }); ids.stops.push(stop.id);
  }
  const routeMinutes = [null, 10, 20, 15];
  const route = await db.route.create({ data: { name: tag, direction: 'E2E ORDER', stops: { create: ids.stops.map((stopId, index) => ({ stopId, sequence: index + 1, minutesFromPrevious: routeMinutes[index] })) } } }); ids.route = route.id;
  await db.driverRouteAuthorization.create({data:{driverId:ids.driver!,routeId:route.id}});
  const driverToken = await login(email, password, '198.51.100.1');
  const adminToken = await login('admin@example.test', 'DevelopmentOnly123!', '198.51.100.2');
  await securityChecks(adminToken);
  const scheduleBody = (departureAt: Date) => JSON.stringify({ routeId: ids.route, driverId: ids.driver, vehicleId: ids.vehicle, departureAt: departureAt.toISOString() });
  const pastSchedule = await request('/admin/schedules', { method: 'POST', body: scheduleBody(new Date(Date.now() - 60_000)) }, adminToken);
  assert(pastSchedule.status === 404, 'Admin schedule creation must be unavailable');
  const futureSchedule = await legacySchedule(scheduleBody(new Date(Date.now() + 3 * 3_600_000)));
  assert(futureSchedule.status === 201 && futureSchedule.body?.trip?.status === 'SCHEDULED', `Future schedule was not SCHEDULED: ${JSON.stringify(futureSchedule.body)}`); ids.schedules.push(futureSchedule.body.id); ids.trips.push(futureSchedule.body.trip.id);
  const futureAssignment = await request('/driver/assignment', {}, driverToken); assert(futureAssignment.body?.id === futureSchedule.body.trip.id && futureAssignment.body.status === 'SCHEDULED' && futureAssignment.body.canStart === false, 'Future assignment was not presented as non-startable');
  const tooEarly = await request(`/driver/trips/${futureSchedule.body.trip.id}/start`, { method: 'POST' }, driverToken); assert(tooEarly.status === 409 && tooEarly.body?.code === 'TRIP_TOO_EARLY', 'Future trip start was not rejected as too early');
  const cancelledFuture = await request(`/admin/schedules/${futureSchedule.body.id}/cancel`, { method: 'POST' }, adminToken); assert(cancelledFuture.status === 201 && cancelledFuture.body?.trip?.status === 'CANCELLED', 'Future schedule cancellation failed');
  assert((await request(`/driver/trips/${futureSchedule.body.trip.id}/start`, { method: 'POST' }, driverToken)).body?.code === 'TRIP_NOT_READY', 'Cancelled trip could be restarted');
  results.tripLifecycle = 'PASS';
  let passenger = await connectSocket(); let admin = await connectSocket(adminToken);
  const passengerLocations: any[] = [], passengerCompleted: any[] = [], adminStarted: any[] = [], adminLocations: any[] = [], adminCompleted: any[] = [];
  const bindPassenger = () => { passenger.on('trip.location.updated', (v: any) => passengerLocations.push(v)); passenger.on('trip.completed', (v: any) => passengerCompleted.push(v)); };
  const bindAdmin = () => { admin.on('trip.started', (v: any) => adminStarted.push(v)); admin.on('trip.location.updated', (v: any) => adminLocations.push(v)); admin.on('trip.completed', (v: any) => adminCompleted.push(v)); };
  bindPassenger(); bindAdmin();
  assert((await subscribe(admin, 'admin.subscribe'))?.ok, 'Active admin realtime subscription was rejected');
  const anonymousAdmin = await connectSocket(); assert((await subscribe(anonymousAdmin, 'admin.subscribe'))?.code === 'ADMIN_UNAUTHORIZED', 'Anonymous admin subscription was accepted'); anonymousAdmin.disconnect();
  const driverAdmin = await connectSocket(driverToken); assert((await subscribe(driverAdmin, 'admin.subscribe'))?.code === 'ADMIN_UNAUTHORIZED', 'Driver token joined the admin room'); driverAdmin.disconnect();
  const inactiveEmail = `${tag}-inactive-admin@example.test`, inactivePassword = `Inactive-${randomUUID()}!`;
  const inactiveAdmin = await db.user.create({ data: { email: inactiveEmail, passwordHash: await argon2.hash(inactivePassword), role: 'ADMIN' } }); securityUsers.push(inactiveAdmin.id);
  const inactiveToken = await login(inactiveEmail, inactivePassword, '198.51.100.31'); await db.user.update({ where: { id: inactiveAdmin.id }, data: { accountStatus: 'DISABLED' } });
  const inactiveSocket = await connectSocket(inactiveToken); assert((await subscribe(inactiveSocket, 'admin.subscribe'))?.code === 'ADMIN_UNAUTHORIZED', 'Inactive admin joined the admin room'); inactiveSocket.disconnect();

  assert((await subscribe(passenger, 'trip.subscribe', { tripId: 'malformed' }))?.code === 'INVALID_TRIP_ID', 'Malformed trip ID was accepted');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId: randomUUID() }))?.code === 'TRIP_UNAVAILABLE', 'Nonexistent trip was accepted');
  const nearSchedule = await legacySchedule(scheduleBody(new Date(Date.now() + 30 * 60_000)));
  assert(nearSchedule.status === 201 && nearSchedule.body?.trip?.status === 'READY', `Near-departure schedule was not READY: ${JSON.stringify(nearSchedule.body)}`); ids.schedules.push(nearSchedule.body.id); ids.trips.push(nearSchedule.body.trip.id);
  const tripId = nearSchedule.body.trip.id as string;
  const readyAssignment = await request('/driver/assignment', {}, driverToken); assert(readyAssignment.body?.id === tripId && readyAssignment.body.status === 'READY' && readyAssignment.body.canStart === true, 'Eligible READY assignment was not selected');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.code === 'TRIP_UNAVAILABLE', 'READY trip was accepted for public tracking');
  const before = await request(`/public/trips/search?fromStopId=${ids.stops[0]}&toStopId=${ids.stops[2]}`);
  assert(before.status === 200 && !before.body.some((x: any) => x.tripId === tripId), 'Trip was public before trusted GPS');
  await startTrip(tripId, driverToken); await waitFor(() => adminStarted.filter(x => x.tripId === tripId).length === 1, 'trip.started');
  const activeAssignment = await request('/driver/assignment', {}, driverToken); assert(activeAssignment.body?.id === tripId && activeAssignment.body.status === 'ACTIVE', 'Existing ACTIVE trip did not win assignment selection');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.ok, 'Anonymous ACTIVE trip subscription failed');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.ok, 'Repeated same-trip subscription was not idempotent');
  assert((await subscribe(passenger, 'trip.unsubscribe', { tripId }))?.subscribed === false, 'Trip unsubscribe failed');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.ok, 'Trip resubscription after unsubscribe failed');
  const isolationEmail = `${tag}-isolation@example.test`, isolationPassword = `Isolation-${randomUUID()}!`;
  const isolationUser = await db.user.create({ data: { email: isolationEmail, passwordHash: await argon2.hash(isolationPassword), role: 'DRIVER', driver: { create: { firstName: 'Room', lastName: 'Isolation', active: true, licenseNumber: `${tag}-isolation-license`, licenseExpiresAt: new Date(Date.now() + 365 * 86400000), identityVerificationStatus: 'APPROVED', licenseVerificationStatus: 'APPROVED' } } }, include: { driver: true } }); securityUsers.push(isolationUser.id);
  const isolationVehicle = await db.vehicle.create({ data: { type: 'VAN', plateNumber: `${tag}-iso`, displayName: `E2E isolation ${tag}`, active: true, assignedDriverId: isolationUser.driver!.id } }); securityVehicles.push(isolationVehicle.id);
  await db.driverRouteAuthorization.create({data:{driverId:isolationUser.driver!.id,routeId:ids.route!}});
  const isolationToken = await login(isolationEmail, isolationPassword, '198.51.100.32');
  const missedSchedule = await db.schedule.create({ data: { routeId: ids.route!, driverId: isolationUser.driver!.id, vehicleId: isolationVehicle.id, departureAt: new Date(Date.now() - 31 * 60_000), trip: { create: { routeId: ids.route!, driverId: isolationUser.driver!.id, vehicleId: isolationVehicle.id, scheduledDepartureAt: new Date(Date.now() - 31 * 60_000), status: 'READY' } } }, include: { trip: true } });
  ids.schedules.push(missedSchedule.id); ids.trips.push(missedSchedule.trip!.id);
  await request('/driver/assignment', {}, isolationToken);
  const missedTrip = await db.trip.findUniqueOrThrow({ where: { id: missedSchedule.trip!.id }, include: { events: true } });
  assert(missedTrip.status === 'CANCELLED' && missedTrip.events.some(event => event.type === 'CANCELLED' && (event.metadata as any)?.reason === 'MISSED_START_WINDOW'), 'Missed trip was not retired with an authoritative reason');
  await db.trip.delete({ where: { id: missedTrip.id } }); await db.schedule.delete({ where: { id: missedSchedule.id } });
  const raceScheduleResponse = await legacySchedule(JSON.stringify({ routeId: ids.route, driverId: isolationUser.driver!.id, vehicleId: isolationVehicle.id, departureAt: new Date(Date.now() + 20 * 60_000).toISOString() }));
  assert(raceScheduleResponse.status === 201 && raceScheduleResponse.body?.trip?.status === 'READY', 'Start/cancel race fixture was not READY');
  const raceScheduleId = raceScheduleResponse.body.id as string, raceScheduleTripId = raceScheduleResponse.body.trip.id as string;
  ids.schedules.push(raceScheduleId); ids.trips.push(raceScheduleTripId);
  const race = await Promise.all([request(`/driver/trips/${raceScheduleTripId}/start`, { method: 'POST' }, isolationToken), request(`/admin/schedules/${raceScheduleId}/cancel`, { method: 'POST' }, adminToken)]);
  assert(race.filter(result => result.status === 201).length === 1 && race.filter(result => result.status === 409).length === 1, `Start/cancel race was not single-winner: ${race.map(result => result.status).join('/')}`);
  const raceTripState = await db.trip.findUniqueOrThrow({ where: { id: raceScheduleTripId } }); assert(['ACTIVE','CANCELLED'].includes(raceTripState.status), 'Start/cancel race produced an invalid state');
  if (raceTripState.status === 'ACTIVE') assert((await request(`/driver/trips/${raceScheduleTripId}/complete`, { method: 'POST' }, isolationToken)).status === 201, 'Race winner trip cleanup completion failed');
  await db.trip.delete({ where: { id: raceScheduleTripId } }); await db.schedule.delete({ where: { id: raceScheduleId } });
  const isolationTrip = await db.trip.create({ data: { routeId: ids.route!, driverId: isolationUser.driver!.id, vehicleId: isolationVehicle.id, status: 'ACTIVE', scheduledDepartureAt: new Date(), startedAt: new Date() } }); ids.trips.push(isolationTrip.id);
  const isolationPoint = point(-1, { latitude: 10.70009, longitude: 124.80009 }); assert((await gps(isolationTrip.id, isolationToken, isolationPoint)).body?.promoted, 'Isolation trip GPS failed');
  await waitFor(() => adminLocations.some(value => value.tripId === isolationTrip.id), 'admin isolation event'); await sleep(300);
  assert(!passengerLocations.some(value => value.tripId === isolationTrip.id), 'Trip A subscriber received Trip B location');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId: isolationTrip.id }))?.ok, 'Trip A to Trip B switch failed');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.ok, 'Trip B to Trip A switch failed');
  adminLocations.splice(0, adminLocations.length); await db.trip.delete({ where: { id: isolationTrip.id } }); await db.vehicle.delete({ where: { id: isolationVehicle.id } }); await db.user.delete({ where: { id: isolationUser.id } });
  results.realtimeSecurity = 'PASS';

  const baseline = point(0); const baselineResponse = await gps(tripId, driverToken, baseline);
  assert(baselineResponse.status === 201 && baselineResponse.body?.promoted === true, 'Trusted GPS was not accepted');
  await waitFor(() => passengerLocations.length === 1 && adminLocations.length === 1, 'baseline realtime');
  const [ledger, current, trip, legacyRawTable, legacyWrites] = await Promise.all([
    db.gpsIngestionEvent.findUnique({ where: { eventId: baseline.eventId as string } }),
    db.vehicleCurrentLocation.findUnique({ where: { tripId } }),
    db.trip.findUnique({ where: { id: tripId } }),
    db.$queryRaw<Array<{ table_name: string | null }>>`SELECT to_regclass('public."TripLocationHistory"')::text AS "table_name"`,
    db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS "count" FROM "TripLocationHistory" WHERE "eventId" = ${baseline.eventId as string}`,
  ]);
  assert(ledger?.status === 'PROMOTED' && current && current.latitude === baseline.latitude && trip?.lastLocationAt, 'Trusted GPS persistence mismatch');
  assert(!('latitude' in ledger) && !('longitude' in ledger), 'Raw GPS coordinates leaked into bounded ingestion metadata');
  assert(legacyRawTable[0]?.table_name === '"TripLocationHistory"' && legacyWrites[0]?.count === 0n, 'Expand/deploy compatibility contract failed');
  assert(!('eventId' in current), 'eventId leaked into VehicleCurrentLocation');
  const visible = await request(`/public/trips/search?fromStopId=${ids.stops[0]}&toStopId=${ids.stops[2]}`);
  assert(visible.status === 200 && visible.body.some((x: any) => x.tripId === tripId), 'Trip was not visible after trusted GPS');
  results.validGps = 'PASS';

  const batchOlder = point(5, { latitude: 10.70011, longitude: 124.80011 });
  const batchNewer = point(10, { latitude: 10.70012, longitude: 124.80012 });
  const batchResponse = await request(`/driver/trips/${tripId}/locations/batch`, { method: 'POST', body: JSON.stringify({ events: [batchNewer, batchOlder] }) }, driverToken);
  assert(batchResponse.status === 201 && batchResponse.body?.results?.every((x: any) => x.promoted), 'Offline GPS batch was not ordered and promoted');
  await waitFor(() => passengerLocations.length === 3 && adminLocations.length === 3, 'offline batch realtime');
  const afterBatch = await db.vehicleCurrentLocation.findUniqueOrThrow({ where: { tripId } });
  assert(afterBatch.latitude === batchNewer.latitude && afterBatch.recordedAt.getTime() === new Date(batchNewer.recordedAt as string).getTime(), `Offline batch did not preserve newest current state: ${JSON.stringify({actualLatitude:afterBatch.latitude,expectedLatitude:batchNewer.latitude,actualAt:afterBatch.recordedAt,expectedAt:batchNewer.recordedAt})}`);
  results.offlineBatch = 'PASS';

  const stale = point(7, { latitude: 10.700115, longitude: 124.800115 });
  const staleResponse = await gps(tripId, driverToken, stale);
  const staleLedger = await db.gpsIngestionEvent.findUnique({ where: { eventId: stale.eventId as string } });
  const afterStale = await db.vehicleCurrentLocation.findUniqueOrThrow({ where: { tripId } });
  assert(staleResponse.body?.promoted === false && staleResponse.body?.rejectionReason === 'STALE_LOCATION' && staleLedger?.status === 'STALE', 'Out-of-order GPS was not classified as stale');
  assert(afterStale.recordedAt.getTime() === afterBatch.recordedAt.getTime() && passengerLocations.length === 3 && adminLocations.length === 3, 'Out-of-order GPS regressed or published current state');
  results.outOfOrderGps = 'PASS';

  const durableStopEvent = await db.tripEvent.findFirst({ where: { tripId, type: { in: ['STOP_APPROACHING', 'STOP_ARRIVED'] }, stopId: ids.stops[0] } });
  assert(durableStopEvent, 'Trusted GPS did not advance durable stop progression');
  results.stopProgression = 'PASS';

  const lastTrustedAt = (await db.trip.findUniqueOrThrow({ where: { id: tripId } })).lastLocationAt!.getTime(); const inaccurate = point(15, { accuracy: 300 });
  const stopEventsBeforeSuspicious = await db.tripEvent.count({ where: { tripId, type: { in: ['STOP_APPROACHING', 'STOP_ARRIVED', 'STOP_PASSED'] } } });
  const impossible = point(20, { latitude: 12.0, longitude: 126.0, speed: 100 });
  assert((await gps(tripId, driverToken, inaccurate)).body?.rejectionReason === 'ACCURACY_EXCEEDS_200_METERS', 'Inaccurate GPS was not quarantined');
  assert((await gps(tripId, driverToken, impossible)).body?.rejectionReason === 'IMPOSSIBLE_SPEED', 'Impossible-speed GPS was not quarantined');
  const duplicate = await gps(tripId, driverToken, impossible); assert(duplicate.body?.duplicate === true && duplicate.body?.suspicious === true, 'Suspicious GPS was not idempotent');
  results.duplicateGps = 'PASS';
  const quarantined = await db.gpsIngestionEvent.findMany({ where: { eventId: { in: [inaccurate.eventId as string, impossible.eventId as string] } } });
  const afterSuspicious = await db.trip.findUniqueOrThrow({ where: { id: tripId }, include: { currentLocation: true } });
  assert(quarantined.length === 2 && quarantined.every(x => x.status === 'REJECTED' && x.rejectionReason && !('latitude' in x)), 'Bounded rejection metadata missing');
  assert(afterSuspicious.lastLocationAt!.getTime() === lastTrustedAt && afterSuspicious.currentLocation!.latitude === batchNewer.latitude, 'Suspicious GPS replaced trusted state');
  assert(passengerLocations.length === 3 && adminLocations.length === 3, 'Suspicious GPS published realtime');
  assert(await db.tripEvent.count({ where: { tripId, type: { in: ['STOP_APPROACHING', 'STOP_ARRIVED', 'STOP_PASSED'] } } }) === stopEventsBeforeSuspicious, 'Suspicious GPS triggered stop detection');
  const recovery = point(30, { latitude: 10.7002, longitude: 124.8002 }); assert((await gps(tripId, driverToken, recovery)).body?.promoted, 'Recovery GPS not promoted');
  await waitFor(() => passengerLocations.length === 4 && adminLocations.length === 4, 'recovery realtime');
  results.gpsQuarantine = 'PASS';
  const publicKeys = Object.keys(passengerLocations[0]);
  assert(['driver', 'compliance', 'user', 'verification', 'licenseNumber'].every(key => !publicKeys.includes(key)), 'Public realtime payload contains internal/admin fields');
  assert(passengerLocations[0].tripId === tripId && passengerLocations[0].latitude === baseline.latitude, 'Passenger realtime payload mismatch');
  results.passengerRealtime = 'PASS'; results.adminRealtime = 'PASS';

  passenger.disconnect(); admin.disconnect(); const disconnected = point(40, { latitude: 10.7003, longitude: 124.8003 }); assert((await gps(tripId, driverToken, disconnected)).body?.promoted, 'Disconnected GPS failed');
  passenger = await connectSocket(); admin = await connectSocket(adminToken); bindPassenger(); bindAdmin(); assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.ok, 'Passenger reconnect subscription failed'); assert((await subscribe(admin, 'admin.subscribe'))?.ok, 'Admin reconnect subscription failed');
  const [publicLocation, adminLive] = await Promise.all([request(`/public/trips/${tripId}/location`), request('/admin/live', {}, adminToken)]);
  assert(publicLocation.status === 200 && publicLocation.body.latitude === disconnected.latitude, 'Passenger HTTP resync mismatch');
  assert(adminLive.status === 200 && adminLive.body.find((x: any) => x.id === tripId)?.currentLocation?.latitude === disconnected.latitude, 'Admin HTTP resync mismatch');
  assert(!JSON.stringify(adminLive.body).includes('passwordHash') && !JSON.stringify(adminLive.body).includes('tokenHash'), 'Admin live response exposed authentication secrets');
  results.reconnect = 'PASS';

  const pidBefore = apiPid; compose('stop', 'redis'); redisStopped = true; await sleep(2500);
  const outage = point(50, { latitude: 10.7004, longitude: 124.8004 }); const outageResponse = await gps(tripId, driverToken, outage);
  assert(outageResponse.status === 201 && outageResponse.body?.promoted && processAlive() && apiPid === pidBefore, `API/GPS failed during Redis outage: HTTP ${outageResponse.status}, body ${JSON.stringify(outageResponse.body)}, alive ${processAlive()}, pid ${apiPid}/${pidBefore}`);
  const [outageDb, outageLedger] = await Promise.all([
    db.trip.findUniqueOrThrow({ where: { id: tripId }, include: { currentLocation: true } }),
    db.gpsIngestionEvent.findUnique({ where: { eventId: outage.eventId as string } }),
  ]);
  assert(outageLedger?.status === 'PROMOTED' && outageDb.currentLocation?.latitude === outage.latitude && outageDb.lastLocationAt, 'PostgreSQL did not persist outage GPS');
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

  const etaBeforeMove = await request(`/public/trips/search?fromStopId=${ids.stops[1]}&toStopId=${ids.stops[3]}`);
  const etaBeforeRide = etaBeforeMove.body.find((value: any) => value.tripId === tripId);
  assert(etaBeforeRide?.boardingEta?.status === 'AVAILABLE' && etaBeforeRide.boardingEta.seconds > 0, 'Fresh boarding ETA was not available');
  const fartherBoarding = await request(`/public/trips/search?fromStopId=${ids.stops[2]}&toStopId=${ids.stops[3]}`);
  const fartherRide = fartherBoarding.body.find((value: any) => value.tripId === tripId);
  assert(fartherRide?.boardingEta?.seconds > etaBeforeRide.boardingEta.seconds, 'Different boarding stops did not produce distinct route-aware ETAs');
  const etaProgressPoint = point(90, { latitude: 10.705, longitude: 124.805, speed: 18 });
  assert((await gps(tripId, driverToken, etaProgressPoint)).body?.promoted, 'ETA progression GPS was not promoted');
  const etaAfterMove = await request(`/public/trips/search?fromStopId=${ids.stops[1]}&toStopId=${ids.stops[3]}`);
  const etaAfterRide = etaAfterMove.body.find((value: any) => value.tripId === tripId);
  assert(etaAfterRide?.boardingEta?.seconds < etaBeforeRide.boardingEta.seconds, 'Boarding ETA did not decrease after valid route progress');
  const authoritativeRecordedAt = new Date(etaProgressPoint.recordedAt as string);
  await db.vehicleCurrentLocation.update({ where: { tripId }, data: { recordedAt: new Date(Date.now() - 200_000) } });
  const staleEta = await request(`/public/trips/search?fromStopId=${ids.stops[1]}&toStopId=${ids.stops[3]}`);
  assert(staleEta.body.find((value: any) => value.tripId === tripId)?.boardingEta?.status === 'APPROXIMATE', 'Stale location did not produce approximate ETA');
  await db.vehicleCurrentLocation.update({ where: { tripId }, data: { recordedAt: new Date(Date.now() - 700_000) } });
  const offlineEta = await request(`/public/trips/search?fromStopId=${ids.stops[1]}&toStopId=${ids.stops[3]}`);
  assert(offlineEta.body.find((value: any) => value.tripId === tripId)?.boardingEta?.status === 'UNAVAILABLE', 'Offline location did not make ETA unavailable');
  await db.vehicleCurrentLocation.update({ where: { tripId }, data: { recordedAt: authoritativeRecordedAt } });
  const progressionBeforePassedCheck = (await db.trip.findUniqueOrThrow({ where: { id: tripId } })).lastPassedSequence;
  await db.trip.update({ where: { id: tripId }, data: { lastPassedSequence: 2 } });
  const passedDetail = await request(`/public/trips/${tripId}?boardingStopId=${ids.stops[1]}&destinationStopId=${ids.stops[3]}`);
  assert(passedDetail.body?.boardingEta?.status === 'BOARDING_STOP_PASSED', 'Passed boarding stop was not reported clearly');
  await db.trip.update({ where: { id: tripId }, data: { lastPassedSequence: progressionBeforePassedCheck } });
  results.passengerEta = 'PASS';

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
  const publicRoute = routes.body.find((x: any) => x.id === ids.route); assert(publicRoute && publicRoute.stops.map((x: any) => x.sequence).join(',') === '1,2,3,4' && publicRoute.stops[1].minutesFromPrevious === 10, 'Passenger route order/timing failed');
  const afterCompletion = await request(`/public/trips/search?fromStopId=${ids.stops[0]}&toStopId=${ids.stops[2]}`);
  assert(!afterCompletion.body.some((x: any) => x.tripId === tripId) && (await request(`/public/trips/${tripId}/location`)).status === 404, 'Completed trip remained public');
  assert((await subscribe(passenger, 'trip.subscribe', { tripId }))?.code === 'TRIP_UNAVAILABLE', 'Completed trip subscription was accepted');
  const restartCompleted = await request(`/driver/trips/${tripId}/start`, { method: 'POST' }, driverToken); assert(restartCompleted.status === 409 && restartCompleted.body?.code === 'TRIP_NOT_READY', 'Completed trip could be restarted');
  const cancelledTrip = await db.trip.create({ data: { routeId: ids.route!, driverId: ids.driver!, vehicleId: ids.vehicle!, status: 'CANCELLED', scheduledDepartureAt: new Date(), endedAt: new Date() } }); ids.trips.push(cancelledTrip.id);
  assert((await subscribe(passenger, 'trip.subscribe', { tripId: cancelledTrip.id }))?.code === 'TRIP_UNAVAILABLE', 'Cancelled trip subscription was accepted');
  results.passengerE2e = 'PASS';
  const finalAdminLive = await request('/admin/live', {}, adminToken); assert(finalAdminLive.status === 200 && !finalAdminLive.body.some((x: any) => ids.trips.includes(x.id)), 'Completed E2E trips remained in admin live state');
  assert(adminStarted.length === 3 && adminCompleted.filter(x => ids.trips.includes(x.tripId)).length === 3, 'Admin event counts mismatch');
  results.adminE2e = 'PASS'; passenger.disconnect(); admin.disconnect();
  await pilotChecks(adminToken);
}

async function pilotChecks(adminToken:string){
  const fixtures:{userId:string;driverId:string;vehicleId:string;email:string;token:string;tripId:string}[]=[];
  const schedulesBefore=await db.schedule.count();
  for(let index=0;index<3;index++){
    const email=`${tag}-pilot-${index}@example.test`;
    const user=await db.user.create({data:{email,passwordHash:await argon2.hash(password),role:'DRIVER',driver:{create:{firstName:'Pilot',lastName:`Fixture ${index}`,active:true,licenseNumber:`${tag}-${index}`,licenseExpiresAt:new Date(Date.now()+86400000),identityVerificationStatus:'APPROVED',licenseVerificationStatus:'APPROVED'}}},include:{driver:true}});securityUsers.push(user.id);
    const vehicle=await db.vehicle.create({data:{type:index===2?'BUS':'VAN',displayName:`Pilot fixture ${index}`,plateNumber:`${tag}-pilot-${index}`,conductionSticker:index===0?'TEST-OPTIONAL':null,capacity:15,assignedDriverId:user.driver!.id}});securityVehicles.push(vehicle.id);
    assert((await request(`/admin/drivers/${user.driver!.id}/routes`,{method:'PATCH',body:JSON.stringify({routeIds:[ids.route]})},adminToken)).status===200,'Admin route authorization failed');
    const token=await login(email,password,`198.51.100.${60+index}`);
    assert((await request('/driver/trips/start',{method:'POST',body:JSON.stringify({routeId:randomUUID(),vehicleId:vehicle.id,startStopId:ids.stops[0],destinationStopId:ids.stops[ids.stops.length-1]})},token)).status===403,'Unauthorized autonomous route accepted');
    const started=await request('/driver/trips/start',{method:'POST',body:JSON.stringify({routeId:ids.route,vehicleId:vehicle.id,startStopId:ids.stops[0],destinationStopId:ids.stops[ids.stops.length-1]})},token);
    assert(started.status===201&&started.body.status==='ACTIVE'&&started.body.occupancyStatus==='VACANT'&&started.body.startedAt&&!started.body.scheduleId&&!started.body.scheduledDepartureAt,'Autonomous start contract failed');
    ids.trips.push(started.body.id);fixtures.push({userId:user.id,driverId:user.driver!.id,vehicleId:vehicle.id,email,token,tripId:started.body.id});
    assert((await request('/driver/trips/start',{method:'POST',body:JSON.stringify({routeId:ids.route,vehicleId:vehicle.id,startStopId:ids.stops[0],destinationStopId:ids.stops[ids.stops.length-1]})},token)).status===409,'Duplicate autonomous start accepted');
  }
  assert(await db.schedule.count()===schedulesBefore,'Autonomous starts created departure schedules');
  const overview=await connectSocket(),locations:any[]=[],occupancies:any[]=[],completed:any[]=[];
  overview.on('trip.location.updated',(event:any)=>locations.push(event));overview.on('trip.occupancy.updated',(event:any)=>occupancies.push(event));overview.on('trip.completed',(event:any)=>completed.push(event));
  const context={fromStopId:ids.stops[0],toStopId:ids.stops[3],tripIds:fixtures.map(value=>value.tripId)};
  const subscription=await subscribe(overview,'trips.subscribe',context);assert(subscription?.ok&&subscription.tripIds.length===3,'Three-trip overview subscription failed');
  for(const [index,fixture]of fixtures.entries())assert((await gps(fixture.tripId,fixture.token,{eventId:`${tag}-pilot-gps-${index}`,latitude:10.7001+index*.0001,longitude:124.8001,accuracy:10,speed:5,recordedAt:new Date().toISOString()})).body?.promoted,'Pilot GPS failed');
  await waitFor(()=>new Set(locations.map(event=>event.tripId)).size===3,'three independent vehicle events');
  const first=fixtures[0];
  for(const occupancyStatus of ['FULL','VACANT','FULL'])assert((await request(`/driver/trips/${first.tripId}/occupancy`,{method:'PATCH',body:JSON.stringify({occupancyStatus})},first.token)).status===200,'Occupancy persistence failed');
  await waitFor(()=>occupancies.length===3,'occupancy events');assert(occupancies.every(event=>event.tripId===first.tripId&&event.vehicleId===first.vehicleId&&event.updatedAt),'Occupancy identity contract failed');
  const search=await request(`/public/trips/search?fromStopId=${context.fromStopId}&toStopId=${context.toStopId}`);
  assert(fixtures.every(fixture=>search.body.some((ride:any)=>ride.tripId===fixture.tripId&&ride.location?.recordedAt)),'Overview initial locations missing');
  assert(search.body.find((ride:any)=>ride.tripId===first.tripId)?.occupancyStatus==='FULL','FULL vehicle disappeared or initial occupancy missing');
  assert((await db.vehicle.findUniqueOrThrow({where:{id:first.vehicleId}})).capacity===15,'Occupancy changed registered capacity');
  const detail=await request(`/public/trips/${first.tripId}`);assert(detail.body.vehicle.plateNumber===`${tag}-pilot-0`&&detail.body.vehicle.conductionSticker==='TEST-OPTIONAL'&&!detail.body.driver,'Registered identity or privacy failed');
  assert(!(await request(`/public/trips/search?fromStopId=${context.toStopId}&toStopId=${context.fromStopId}`)).body.some((ride:any)=>fixtures.some(fixture=>fixture.tripId===ride.tripId)),'Reverse route incorrectly matched');
  assert((await request(`/driver/trips/${first.tripId}/occupancy`,{method:'PATCH',body:JSON.stringify({occupancyStatus:'VACANT'})},fixtures[1].token)).status===403,'Another driver changed occupancy');
  assert((await request(`/driver/trips/${first.tripId}/complete`,{method:'POST'},first.token)).status===201,'Autonomous end failed');await waitFor(()=>completed.some(event=>event.tripId===first.tripId),'overview completion');
  overview.disconnect();const reconnected=await connectSocket();const restored=await subscribe(reconnected,'trips.subscribe',context);assert(restored?.tripIds.length===2&&!restored.tripIds.includes(first.tripId),'Reconnect retained completed trip');reconnected.disconnect();
  results.pilotOperations='PASS';results.pilotOverview='PASS';
  const replacement=fixtures[1];
  const secondDevice=await request('/auth/login',{method:'POST',headers:{'x-forwarded-for':'198.51.100.70'},body:JSON.stringify({email:replacement.email,password,deviceCredential:null})});assert(secondDevice.status===403,'Second driver device accepted');
  assert((await request(`/admin/drivers/${replacement.driverId}/device/reset`,{method:'POST'},adminToken)).status===201,'Device reset failed');
  for(const [path,method,body]of [[`/driver/trips/${replacement.tripId}/complete`,'POST',{}],[`/driver/trips/${replacement.tripId}/occupancy`,'PATCH',{occupancyStatus:'FULL'}],['/driver/trips/start','POST',{routeId:ids.route,vehicleId:replacement.vehicleId,startStopId:ids.stops[0],destinationStopId:ids.stops[ids.stops.length-1]}],[`/driver/trips/${replacement.tripId}/locations/batch`,'POST',{events:[]}] ]as const)assert((await request(path,{method,body:JSON.stringify(body)},replacement.token)).status===401,'Reset device retained privileged access');
  replacement.token=await login(replacement.email,password,'198.51.100.71');
  assert((await request('/driver/operations',{},replacement.token)).body.activeTrip?.id===replacement.tripId,'Replacement device could not resume active trip');
  for(const fixture of fixtures.slice(1))assert((await request(`/driver/trips/${fixture.tripId}/complete`,{method:'POST'},fixture.token)).status===201,'Pilot cleanup end failed');
  results.pilotDeviceReset='PASS';
}

async function cleanup() {
  for (const socket of openSockets) socket.disconnect();
  if (redisStopped) { try { compose('start', 'redis'); } catch {} }
  try {
    if (ids.trips.length) await db.trip.deleteMany({ where: { id: { in: ids.trips } } });
    if (ids.schedules.length) await db.schedule.deleteMany({ where: { id: { in: ids.schedules } } });
    if (ids.route) await db.route.delete({ where: { id: ids.route } }).catch(() => undefined);
    if (ids.stops.length) await db.stop.deleteMany({ where: { id: { in: ids.stops } } });
    if (securityVehicles.length) await db.vehicle.deleteMany({ where: { id: { in: securityVehicles } } });
    if (ids.vehicle) await db.vehicle.delete({ where: { id: ids.vehicle } }).catch(() => undefined);
    if (ids.user) { await db.auditLog.deleteMany({ where: { actorId: ids.user } }); await db.user.delete({ where: { id: ids.user } }).catch(() => undefined); }
    for (const userId of securityUsers) { await db.auditLog.deleteMany({ where: { actorId: userId } }); await db.user.delete({ where: { id: userId } }).catch(() => undefined); }
    for (const storageKey of securityStorageKeys) await unlink(`${process.env.DRIVER_DOCUMENT_STORAGE_DIR}/${storageKey}`).catch(() => undefined);
  } finally { await db.$disconnect(); await writeFile(resultFile, JSON.stringify(results)); }
}

main().catch(error => { console.error(`E2E gate failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }).finally(cleanup);
