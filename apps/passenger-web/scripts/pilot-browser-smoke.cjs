// Isolated browser fixtures only. Build with explicit local API/socket overrides.
// Requires playwright-core and an installed Chromium browser; no production API is used.
const { chromium } = require('playwright-core');
const { Server } = require('socket.io');
const { createServer } = require('node:http');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const stop = (id, name, latitude, longitude) => ({ id, name, latitude, longitude, province: 'Test province', cityMunicipality: 'Test town' });
const stops = [stop('11111111-1111-4111-8111-111111111111', 'Test origin', 10.4, 124.95), stop('22222222-2222-4222-8222-222222222222', 'Test destination', 10.3, 124.85)];
const eta = { seconds: 300, minutes: 5, display: '5 min', status: 'AVAILABLE', reason: null };
let rides = [], subscriptions = 0;
const freshRides = () => [0, 1, 2].map(i => ({ tripId: `33333333-3333-4333-8333-33333333333${i}`, vehicleId: `vehicle-${i}`, status: 'ACTIVE', vehicle: { displayName: `Test vehicle ${i + 1}`, type: i === 2 ? 'BUS' : 'VAN' }, route: { name: 'Test route', direction: 'OUTBOUND' }, boardingStop: stops[0], destinationStop: stops[1], nextStop: stops[0], distanceKm: 2, boardingEta: eta, destinationEta: eta, remainingTripTime: eta, freshness: 'LIVE', freshnessPolicy: { liveAfterSeconds: 20, offlineAfterSeconds: 600 }, lastUpdatedAt: new Date().toISOString(), location: { latitude: 10.42 - i * .04, longitude: 124.96 - i * .04, recordedAt: new Date().toISOString(), freshness: 'LIVE' }, occupancyStatus: i === 1 ? 'FULL' : 'VACANT', occupancyUpdatedAt: new Date().toISOString() }));
const api = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/v1/public/stops') return res.end(JSON.stringify(stops));
  if (url.pathname === '/api/v1/public/trips/search') return res.end(JSON.stringify(rides));
  const ride = rides.find(ride => url.pathname === '/api/v1/public/trips/' + ride.tripId);
  if (ride) return res.end(JSON.stringify({ ...ride, id: ride.tripId, vehicle: { ...ride.vehicle, plateNumber: 'TEST-123', conductionSticker: 'TEST-STICKER' }, route: { ...ride.route, id: 'test-route', stops: stops.map((stop, i) => ({ sequence: i + 1, stop })) } }));
  res.statusCode = 404; res.end('{}');
});
const io = new Server(api, { cors: { origin: '*' } }), live = io.of('/live');
live.on('connection', socket => {
  socket.on('trips.subscribe', (body, ack) => { assert.equal(body.fromStopId, stops[0].id); assert.equal(body.toStopId, stops[1].id); subscriptions++; ack({ ok: true, tripIds: rides.map(ride => ride.tripId) }); });
  socket.on('trip.subscribe', (_body, ack) => ack({ ok: true }));
});
const web = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(__dirname, '../dist', name === '/' ? 'index.html' : '.' + name);
    if (!file.startsWith(path.resolve(__dirname, '../dist') + path.sep)) throw new Error('Invalid path');
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
const listen = (server, port) => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
async function run() {
  const assets = path.resolve(__dirname, '../dist/assets');
  const bundles = (await Promise.all((await readdir(assets)).filter(name => name.endsWith('.js')).map(name => readFile(path.join(assets, name), 'utf8')))).join('\n');
  assert.ok(bundles.includes('http://127.0.0.1:3000/api/v1') && bundles.includes('"http://127.0.0.1:3000"'), 'Build with explicit local VITE_API_URL and VITE_SOCKET_URL before running fixtures');
  await listen(api, 3000); await listen(web, 4177);
  const browser = await chromium.launch({ executablePath: process.env.SUGAT_BROWSER_PATH, headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const width of [1280, 390]) {
      rides = freshRides();
      const page = await browser.newPage({ viewport: { width, height: 844 } }), errors = [];
      let tiles = 0;
      await page.route('**/*', route => {
        const host = new URL(route.request().url()).hostname;
        return ['127.0.0.1', 'localhost', 'tile.openstreetmap.org'].includes(host) ? route.continue() : route.abort();
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().startsWith('https://tile.openstreetmap.org/') && response.ok()) tiles++; });
      await page.goto('http://127.0.0.1:4177');
      await page.getByPlaceholder('Search origin or boarding stop').fill('Test origin');
      await page.locator('.stop-options button').filter({ hasText: 'Test origin' }).click();
      await page.getByPlaceholder('Search destination', { exact: true }).fill('Test destination');
      await page.locator('.stop-options button').filter({ hasText: 'Test destination' }).click();
      await page.getByRole('button', { name: 'FIND A RIDE' }).click();
      const markers = page.locator('.vehicle-map-marker');
      await page.waitForFunction(() => document.querySelectorAll('.vehicle-map-marker').length === 3);
      assert.equal(await page.locator('.maplibregl-canvas').count(), 1);
      const marker = i => page.getByRole('button', { name: new RegExp(`Test vehicle ${i}`) });
      const positions = await markers.evaluateAll(elements => elements.map(element => element.style.transform));
      assert.equal(new Set(positions).size, 3, 'Coordinates must produce three separate positions');
      rides[0].location = { ...rides[0].location, latitude: 10.41, longitude: 124.95, recordedAt: new Date(Date.now() + 1000).toISOString() };
      live.emit('trip.location.updated', { ...rides[0].location, tripId: rides[0].tripId });
      await page.waitForFunction(previous => document.querySelector('.vehicle-map-marker').style.transform !== previous, positions[0]);
      const moved = await markers.evaluateAll(elements => elements.map(element => element.style.transform));
      assert.equal(moved[1], positions[1]); assert.equal(moved[2], positions[2]);
      rides[0].occupancyStatus = 'FULL'; rides[0].occupancyUpdatedAt = new Date(Date.now() + 2000).toISOString();
      live.emit('trip.occupancy.updated', { tripId: rides[0].tripId, vehicleId: rides[0].vehicleId, occupancyStatus: 'FULL', updatedAt: rides[0].occupancyUpdatedAt });
      await page.waitForFunction(() => document.querySelector('.vehicle-map-marker').textContent.includes('FULL'));
      assert.equal(await marker(1).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(180, 35, 24)');
      assert.equal(await markers.count(), 3, 'FULL stays visible');
      const count = subscriptions;
      for (const socket of live.sockets.values()) socket.conn.close();
      await new Promise((resolve, reject) => { const started = Date.now(); const timer = setInterval(() => { if (subscriptions > count) { clearInterval(timer); resolve(); } else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error('Reconnect failed')); } }, 100); });
      assert.equal(await markers.count(), 3);
      const ended = rides.pop(); live.emit('trip.completed', { tripId: ended.tripId });
      await page.waitForFunction(() => document.querySelectorAll('.vehicle-map-marker').length === 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Phone viewport must not overflow');
      await marker(1).click();
      await page.getByText('Plate number: TEST-123', { exact: true }).waitFor();
      await page.getByText('Conduction sticker: TEST-STICKER', { exact: true }).waitFor();
      assert.equal(await page.locator('.verification-notice').textContent(), "PLEASE VERIFY THE VEHICLE'S PLATE NUMBER AND VEHICLE NAME BEFORE BOARDING. MAKE SURE THEY MATCH THE VEHICLE DETAILS SHOWN IN SUGAT.");
      assert.deepEqual(errors, []);
      assert.ok(tiles > 0, 'Actual geographic raster tiles must load');
      console.log(`PASS ${width}px: real map tiles, three independent markers, FULL color, completion, reconnect, registered identity, notice; ${tiles} tiles`);
      await page.close();
    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { io.close(); api.close(); web.close(); });
