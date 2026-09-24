// Database/API/Redis/browser integration fixtures, never imported by application code.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertIsolatedValidation } from './validation-safety';

assertIsolatedValidation(true);
const base=process.env.SUGAT_VALIDATION_API!,socketBase=process.env.SUGAT_VALIDATION_SOCKET!;
for(const value of [base,socketBase])assert.ok(/^http:\/\/127\.0\.0\.1:5300[01]$/.test(value),'Only isolated API ports are allowed');
const root=process.env.SUGAT_E2E_ROOT!,requireTool=createRequire(path.join(root,'apps/api/package.json'));
const {chromium}=requireTool('playwright-core'),{io}=createRequire(path.join(root,'apps/passenger-web/package.json'))('socket.io-client');
const db=new PrismaClient(),tag='browser-'+Date.now(),password=randomUUID()+'!';
const fixtures:any[]=[],routes:string[]=[],stops:any[]=[],users:string[]=[],sockets:any[]=[];
let adminToken='',browser:any,web:ReturnType<typeof createServer>|undefined;
async function api(route:string,method='GET',body?:unknown,session?:any){const response=await fetch(base+'/api/v1'+route,{method,headers:{'content-type':'application/json',...(session?{authorization:'Bearer '+session.accessToken,'x-sugat-device-credential':session.deviceCredential??''}:{}),'x-forwarded-for':`198.51.100.${session?.ip??150}`},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json().catch(()=>null)}}
const admin=()=>({accessToken:adminToken});
const search=()=>api(`/public/trips/search?fromStopId=${stops[1].id}&toStopId=${stops[3].id}`);
async function gps(fixture:any,_index:number){await new Promise(done=>setTimeout(done,1200));fixture.step=(fixture.step??0)+1;const response=await api(`/driver/trips/${fixture.trip.id}/locations`,'POST',{eventId:randomUUID(),latitude:fixture.latitude+fixture.step*.0004,longitude:fixture.longitude,accuracy:5,speed:4,recordedAt:new Date().toISOString()},fixture.session);assert.equal(response.status,201);assert.equal(response.body.promoted,true);}
async function wait(check:()=>Promise<boolean>|boolean,label:string){for(let i=0;i<100;i++){if(await check())return;await new Promise(done=>setTimeout(done,100))}throw new Error(label+' timed out')}
async function fixture(index:number,routeId:string){
  const email=`${tag}-${index}@example.test`,user=await db.user.create({data:{email,passwordHash:await argon2.hash(password),role:'DRIVER',driver:{create:{firstName:'Browser',lastName:String(index),licenseNumber:tag+index,licenseExpiresAt:new Date(Date.now()+86400000),identityVerificationStatus:'APPROVED',licenseVerificationStatus:'APPROVED'}}},include:{driver:true}});users.push(user.id);
  const vehicle=await db.vehicle.create({data:{type:'VAN',displayName:`${tag} vehicle ${index}`,plateNumber:`${tag}-${index}`,capacity:15,conductionSticker:index===0?'TEST-STICKER':null,assignedDriverId:user.driver!.id}});
  assert.equal((await api(`/admin/drivers/${user.driver!.id}/routes`,'PATCH',{routeIds:[routeId]},admin())).status,200);
  const session=(await api('/auth/login','POST',{email,password},{accessToken:'',ip:151+index})).body;assert.ok(session.deviceCredential);session.ip=151+index;
  const operations=await api('/driver/operations','GET',undefined,session);assert.equal(operations.body.activeTrip,null);assert.equal(operations.body.routes[0].id,routeId);
  const started=await api('/driver/trips/start','POST',{routeId,vehicleId:vehicle.id,startStopId:operations.body.routes[0].stops[0].stopId,destinationStopId:operations.body.routes[0].stops.at(-1).stopId},session);assert.equal(started.status,201);
  const item={user,vehicle,session,trip:started.body,latitude:10.68+index*.005,longitude:124.78-index*.004};fixtures.push(item);await gps(item,0);return item;
}
async function main(){
  adminToken=(await api('/auth/login','POST',{email:'admin@example.test',password:'DevelopmentOnly123!'})).body.accessToken;
  for(let i=0;i<4;i++){const response=await api('/admin/stops','POST',{name:`${tag} stop ${i}`,latitude:10.7+i*.01,longitude:124.8+i*.01},admin());assert.equal(response.status,201);stops.push(response.body)}
  const routeBody={name:tag,direction:'Outbound',stops:stops.map((stop,i)=>({stopId:stop.id,sequence:i+1,boardingAllowed:true,dropoffAllowed:true}))};
  const route=(await api('/admin/routes','POST',routeBody,admin())).body;routes.push(route.id);
  const unrelated=(await api('/admin/routes','POST',{...routeBody,name:tag+' reverse',stops:[...routeBody.stops].reverse().map((stop,i)=>({...stop,sequence:i+1}))},admin())).body;routes.push(unrelated.id);
  for(let i=0;i<3;i++)await fixture(i,route.id);const outsider=await fixture(3,unrelated.id);
  const schedulesBefore=await db.schedule.count();assert.equal((await search()).body.length,3);
  // Security and route matching against the actual API/database.
  assert.equal((await api('/driver/trips/start','POST',{routeId:unrelated.id,vehicleId:fixtures[0].vehicle.id,startStopId:stops[3].id,destinationStopId:stops[0].id},fixtures[0].session)).status,403);
  assert.equal((await api('/driver/trips/start','POST',{routeId:route.id,vehicleId:outsider.vehicle.id,startStopId:stops[0].id,destinationStopId:stops[3].id},fixtures[0].session)).status,403);
  assert.equal((await api(`/admin/routes/${route.id}`,'PATCH',routeBody,admin())).status,409);
  for(const operation of ['complete','locations'])assert.equal((await api(`/driver/trips/${fixtures[0].trip.id}/${operation}`,'POST',operation==='locations'?{eventId:randomUUID(),latitude:10.68,longitude:124.78,accuracy:5,recordedAt:new Date().toISOString()}:undefined,fixtures[1].session)).status,403);
  for(const [field,stopIndex]of [['boardingAllowed',1],['dropoffAllowed',3]]as const){await db.routeStop.update({where:{routeId_sequence:{routeId:route.id,sequence:stopIndex+1}},data:{[field]:false}});assert.equal((await search()).body.length,0);await db.routeStop.update({where:{routeId_sequence:{routeId:route.id,sequence:stopIndex+1}},data:{[field]:true}})}
  await db.trip.update({where:{id:fixtures[0].trip.id},data:{lastPassedSequence:2}});assert.equal((await search()).body.length,2);await db.trip.update({where:{id:fixtures[0].trip.id},data:{lastPassedSequence:0}});
  await db.trip.update({where:{id:fixtures[2].trip.id},data:{occupancyStatus:null,occupancyUpdatedAt:null}});assert.equal((await search()).body.find((value:any)=>value.tripId===fixtures[2].trip.id).occupancyStatus,null);
  console.log('PASS database-backed search: three forward trips, boarding/dropoff permissions, passed stops, null occupancy; unauthorized route/vehicle/GPS/end and active route edits rejected');
  const socket=io(socketBase+'/live',{transports:['websocket'],forceNew:true});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject)});
  const ack=(event:string,body?:unknown)=>new Promise<any>(resolve=>socket.emit(event,body,resolve));
  assert.equal((await ack('admin.subscribe')).ok,false);assert.equal((await ack('trip.subscribe',{tripId:'invalid'})).ok,false);
  const sub=await ack('trips.subscribe',{fromStopId:stops[1].id,toStopId:stops[3].id,tripIds:[...fixtures.map(item=>item.trip.id)]});assert.equal(sub.tripIds.length,3);assert.ok(!sub.tripIds.includes(outsider.trip.id));
  const received:any[]=[];socket.on('trip.location.updated',(event:any)=>received.push(event));await gps(outsider,1);await new Promise(done=>setTimeout(done,200));assert.equal(received.length,0);
  for(let i=0;i<3;i++){await gps(fixtures[i],1);await wait(()=>received.length===i+1,'cross-instance Redis event');assert.equal(received[i].tripId,fixtures[i].trip.id)}socket.disconnect();
  console.log('PASS Redis cross-instance delivery: writes on :53000, subscriptions on :53001, only three authorized matching trips, no outsider/admin exposure');
  const dist=path.join(root,'apps/passenger-web/dist');
  web=createServer(async(req,res)=>{try{const name=new URL(req.url!,'http://local').pathname;const file=path.resolve(dist,name==='/'?'index.html':'.'+name);assert.ok(file.startsWith(dist+path.sep));res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file))}catch{res.statusCode=404;res.end()}});await new Promise<void>(resolve=>web!.listen(4177,'127.0.0.1',resolve));
  browser=await chromium.launch({executablePath:process.env.SUGAT_BROWSER_PATH,headless:true,args:['--enable-unsafe-swiftshader']});
  for(const width of [1280,390]){
    for(const item of fixtures.slice(0,3))await gps(item,width);
    const page=await browser.newPage({viewport:{width,height:844}}),errors:string[]=[];let tiles=0,subscriptions=0,socketsBlocked=false;const browserSockets:any[]=[];
    page.on('pageerror',(error:any)=>errors.push(error.message));page.on('response',(response:any)=>{if(response.url().startsWith('https://tile.openstreetmap.org/')&&response.ok())tiles++});
    await page.routeWebSocket('**/socket.io/**',(ws:any)=>{if(socketsBlocked){ws.close();return}browserSockets.push(ws);const server=ws.connectToServer();ws.onMessage((message:any)=>{if(String(message).includes('trips.subscribe'))subscriptions++;server.send(message)})});
    const disconnect=()=>browserSockets.splice(0).forEach(ws=>ws.close());
    await page.route('**/*',(route:any)=>['127.0.0.1','tile.openstreetmap.org'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    await page.goto('http://127.0.0.1:4177');
    await page.getByPlaceholder('Search origin or boarding stop').fill(stops[1].name);await page.locator('.stop-options button').filter({hasText:stops[1].name}).click();
    await page.getByPlaceholder('Search destination',{exact:true}).fill(stops[3].name);await page.locator('.stop-options button').filter({hasText:stops[3].name}).click();await page.getByRole('button',{name:'FIND A RIDE'}).click();
    const markers=page.locator('.vehicle-map-marker');await wait(async()=>await markers.count()===3,'three browser markers');assert.ok(tiles>0);
    const byName=(i:number)=>page.getByRole('button',{name:new RegExp(fixtures[i].vehicle.displayName)});
    assert.ok((await byName(2).textContent()).includes('UNKNOWN'));
    for(let i=0;i<3;i++){
      const before=await Promise.all([0,1,2].map(j=>byName(j).evaluate((element:any)=>element.style.transform)));await gps(fixtures[i],width+1);
      await wait(async()=>(await byName(i).evaluate((element:any)=>element.style.transform))!==before[i],'independent marker movement '+width+'px trip '+i);for(let j=0;j<3;j++)if(j!==i)assert.equal(await byName(j).evaluate((element:any)=>element.style.transform),before[j]);
    }
    const first=fixtures[0];
    for(const status of ['FULL','VACANT']){assert.equal((await api(`/driver/trips/${first.trip.id}/occupancy`,'PATCH',{occupancyStatus:status},first.session)).status,200);await wait(async()=>(await byName(0).textContent()).includes(status),'browser occupancy');assert.equal((await db.trip.findUniqueOrThrow({where:{id:first.trip.id}})).occupancyStatus,status);assert.equal(await markers.count(),3)}
    await api(`/driver/trips/${first.trip.id}/occupancy`,'PATCH',{occupancyStatus:'FULL'},first.session);await gps(first,width+2);assert.equal((await db.trip.findUniqueOrThrow({where:{id:first.trip.id}})).status,'ACTIVE');
    // Lose sockets only: actual HTTP fallback must retain three vehicles and their identities.
    const beforeReconnect=subscriptions;disconnect();await wait(()=>subscriptions>beforeReconnect,'browser reconnect');
    assert.equal(await markers.count(),3);await byName(0).scrollIntoViewIfNeeded();
    // Nearby vehicles can overlap at overview zoom. Click an exposed part of this
    // marker, rather than forcing a center click through a different vehicle.
    const hit=await byName(0).evaluate((element:any)=>{const rect=element.getBoundingClientRect();for(let y=Math.max(0,rect.top+3);y<Math.min(innerHeight,rect.bottom-3);y+=4)for(let x=Math.max(0,rect.left+3);x<Math.min(innerWidth,rect.right-3);x+=4)if(element.contains(document.elementFromPoint(x,y)))return{x,y};return null});
    assert.ok(hit,'Vehicle marker must have a clickable exposed area');await page.mouse.click(hit.x,hit.y);
    await page.getByText('Plate number: '+first.vehicle.plateNumber,{exact:true}).waitFor();await page.getByText('Conduction sticker: TEST-STICKER',{exact:true}).waitFor();
    assert.equal(await page.locator('.verification-notice').textContent(),"PLEASE VERIFY THE VEHICLE'S PLATE NUMBER AND VEHICLE NAME BEFORE BOARDING. MAKE SURE THEY MATCH THE VEHICLE DETAILS SHOWN IN SUGAT.");
    if(width===1280){
      socketsBlocked=true;disconnect();await new Promise(done=>setTimeout(done,1000));const fallbackStarted=Date.now();
      assert.equal((await api(`/driver/trips/${first.trip.id}/occupancy`,'PATCH',{occupancyStatus:'VACANT'},first.session)).status,200);
      await page.waitForFunction(()=>document.querySelector('.vehicle-identity .occupancy-status')?.textContent==='VACANT',undefined,{timeout:35000});
      assert.ok(Date.now()-fallbackStarted>=20000,'Occupancy must arrive through the periodic fallback, not an already-pending reconnect request');
      await page.getByText('Plate number: '+first.vehicle.plateNumber,{exact:true}).waitFor();
      assert.equal((await search()).body.find((value:any)=>value.tripId===first.trip.id).freshness,'STALE');
      assert.ok((await page.locator('.vehicle-identity').textContent()).includes('STALE'));
      console.log('PASS real 30-second HTTP fallback with sockets blocked: selected trip retained, VACANT + STALE, no duplicate overview markers');
      await api(`/driver/trips/${first.trip.id}/occupancy`,'PATCH',{occupancyStatus:'FULL'},first.session);
    }
    await page.getByRole('button',{name:/BACK TO RIDES/}).click();await wait(async()=>await markers.count()===3,'return to overview');
    // Age database timestamps without changing production thresholds; force HTTP reconciliation via reconnect.
    await db.vehicleCurrentLocation.update({where:{tripId:first.trip.id},data:{recordedAt:new Date(Date.now()-700000)}});
    disconnect();
    // Newer socket coordinates must survive an older HTTP timestamp. A separate trip is aged before a fresh search.
    await page.getByRole('button',{name:'FIND A RIDE'}).click();await wait(async()=>(await byName(0).textContent()).includes('OFFLINE'),'offline freshness');assert.ok((await byName(0).textContent()).includes('FULL'));
    const offline=(await search()).body.find((value:any)=>value.tripId===first.trip.id);assert.equal(offline.boardingEta.status,'UNAVAILABLE');
    await gps(first,width+3);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
    if(width===390){
      let release!:()=>void,captured!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{captured=resolve});let intercepted=false;
      await page.route('**/public/trips/search?**',async(route:any)=>{const response=await route.fetch();if(!intercepted){intercepted=true;captured();await held}await route.fulfill({response})});
      disconnect();await Promise.race([ready,new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('Delayed HTTP request was not started')),15000))]);
      assert.equal((await api(`/driver/trips/${first.trip.id}/complete`,'POST',undefined,first.session)).status,201);await wait(async()=>await markers.count()===2,'completed marker removal');release();
      await new Promise(done=>setTimeout(done,500));assert.equal(await markers.count(),2,'Old HTTP snapshot must not resurrect completed trip');assert.equal((await search()).body.length,2);
      const restarted=await api('/driver/trips/start','POST',{routeId:route.id,vehicleId:first.vehicle.id,startStopId:stops[0].id,destinationStopId:stops[3].id},first.session);assert.equal(restarted.status,201);assert.equal(restarted.body.occupancyStatus,'VACANT');first.trip=restarted.body;assert.equal(await db.schedule.count(),schedulesBefore);
      console.log('PASS real HTTP completion race: delayed snapshot did not restore ended trip');
    }
    console.log(`PASS real-stack browser ${width}px: tiles, three independent Redis markers, FULL/VACANT, reconnect, unknown/offline, identity/notice, responsive layout${width===390?', completion and autonomous restart':''}`);await page.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{sockets.forEach(socket=>socket.disconnect());if(browser)await browser.close();web?.close();for(const fixture of fixtures){await db.trip.deleteMany({where:{driverId:fixture.user.driver!.id}});await db.vehicle.delete({where:{id:fixture.vehicle.id}})}for(const id of routes)await db.route.delete({where:{id}});for(const stop of stops)await db.stop.delete({where:{id:stop.id}});for(const id of users){await db.auditLog.deleteMany({where:{actorId:id}});await db.user.delete({where:{id}})}await db.$disconnect()});
