import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PassengerRide, VEHICLE_VERIFICATION_NOTICE, occupancyLabel } from '@sugat/shared-types';
import { ageRides, reconcileRides, trackOverview, updateRideLocation, updateRideOccupancy } from '../../../packages/shared-utils/src/passenger-tracking';

const now=Date.parse('2026-09-18T12:00:00Z');
const ride=(tripId:string):PassengerRide=>({tripId,vehicleId:'vehicle-'+tripId,status:'ACTIVE',vehicle:{type:'VAN',displayName:tripId},route:{name:'Test route',direction:'Outbound'},boardingStop:{id:'a',name:'A',latitude:10,longitude:124},destinationStop:{id:'b',name:'B',latitude:11,longitude:124},nextStop:null,distanceKm:1,boardingEta:{seconds:120,minutes:2,display:'Arriving soon',status:'AVAILABLE',reason:null},destinationEta:{seconds:300,minutes:5,display:'~5 min',status:'AVAILABLE',reason:null},remainingTripTime:{seconds:300,minutes:5,display:'~5 min',status:'AVAILABLE',reason:null},freshness:'LIVE',freshnessPolicy:{liveAfterSeconds:20,offlineAfterSeconds:600},lastUpdatedAt:new Date(now).toISOString(),location:{latitude:10,longitude:124,recordedAt:new Date(now).toISOString(),freshness:'LIVE'},occupancyStatus:null,occupancyUpdatedAt:null});
afterEach(()=>vi.useRealTimers());
describe('passenger overview state used by Web and Mobile',()=>{
 it('does not publish an empty successful search while the initial HTTP response is pending',async()=>{
  vi.useFakeTimers();const socket={connected:false,on:vi.fn(),off:vi.fn(),emit:vi.fn()};
  let resolve!:(rides:PassengerRide[])=>void;const snapshot=new Promise<PassengerRide[]>(done=>{resolve=done}),changed=vi.fn();
  const tracker=trackOverview({socket,fromStopId:'a',toStopId:'b',fetchRides:()=>snapshot,changed,failed:vi.fn()});
  await vi.advanceTimersByTimeAsync(5000);expect(changed).not.toHaveBeenCalled();
  resolve([ride('a')]);await tracker.refresh();expect(changed.mock.lastCall?.[0]).toHaveLength(1);tracker.dispose();
 });
 it('maintains three separate positions and never moves another trip on a location event',()=>{
  const initial=reconcileRides({},['a','b','c'].map(ride));
  const updated=updateRideLocation(initial,{tripId:'b',latitude:10.5,longitude:124.2,recordedAt:new Date(now+5000).toISOString(),freshness:'LIVE'});
  expect(Object.keys(updated)).toHaveLength(3);expect(updated.b.location?.latitude).toBe(10.5);expect(updated.a).toBe(initial.a);expect(updated.c).toBe(initial.c);
  expect(updateRideLocation(updated,{tripId:'unrelated',latitude:0,longitude:0,recordedAt:new Date(now+5000).toISOString(),freshness:'LIVE'})).toBe(updated);
  expect(reconcileRides(updated,[ride('b')]).b.location?.latitude).toBe(10.5);
 });
 it('retains FULL on the map, rejects older occupancy events, and preserves unknown values',()=>{
  let state=reconcileRides({},[ride('a'),ride('b')]);expect(occupancyLabel(state.b.occupancyStatus)).toContain('UNKNOWN');
  state=updateRideOccupancy(state,{tripId:'a',occupancyStatus:'FULL',updatedAt:new Date(now).toISOString()});
  state=updateRideOccupancy(state,{tripId:'a',occupancyStatus:'VACANT',updatedAt:new Date(now-1000).toISOString()});
  expect(Object.keys(state)).toHaveLength(2);expect(state.a.occupancyStatus).toBe('FULL');
  expect(reconcileRides(state,[ride('a'),ride('b')]).a.occupancyStatus).toBe('FULL');
  state=updateRideOccupancy(state,{tripId:'a',occupancyStatus:'VACANT',updatedAt:new Date(now+1000).toISOString()});expect(state.a.occupancyStatus).toBe('VACANT');
 });
 it('ages all cards and markers independently from occupancy, qualifying/suppressing ETA',()=>{
  const state=reconcileRides({},[{...ride('a'),occupancyStatus:'FULL'}]);
  expect(ageRides(state,now+21000)[0]).toMatchObject({freshness:'STALE',occupancyStatus:'FULL',boardingEta:{status:'APPROXIMATE'}});
  expect(ageRides(state,now+601000)[0]).toMatchObject({freshness:'OFFLINE',occupancyStatus:'FULL',boardingEta:{status:'UNAVAILABLE'},location:{freshness:'OFFLINE'}});
 });
 it('reconnects, reconciles membership, removes completed trips immediately, and falls back to HTTP',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const handlers=new Map<string,Function>();
  const socket={connected:true,on:vi.fn((event,fn)=>handlers.set(event,fn)),off:vi.fn((event)=>handlers.delete(event)),emit:vi.fn()};
  const fetchRides=vi.fn().mockResolvedValue(['a','b','c'].map(ride)),changed=vi.fn(),completed=vi.fn();
  const tracker=trackOverview({socket,fromStopId:'a',toStopId:'b',fetchRides,changed,completed,failed:vi.fn()});await tracker.refresh();
  expect(changed.mock.lastCall?.[0]).toHaveLength(3);expect(socket.emit).toHaveBeenCalledWith('trips.subscribe',expect.objectContaining({fromStopId:'a',toStopId:'b'}),expect.any(Function));
  handlers.get('trip.completed')!({tripId:'b'});await tracker.refresh();expect(changed.mock.lastCall?.[0].map((r:PassengerRide)=>r.tripId)).toEqual(['a','c']);expect(completed).toHaveBeenCalledWith('b');
  handlers.get('connect')!();await tracker.refresh();expect(fetchRides).toHaveBeenCalledTimes(3);
  socket.connected=false;fetchRides.mockResolvedValue([ride('c')]);await vi.advanceTimersByTimeAsync(30000);expect(changed.mock.lastCall?.[0].map((r:PassengerRide)=>r.tripId)).toEqual(['c']);
  tracker.dispose();expect(handlers.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
 it('includes the required physical-vehicle verification instruction',()=>{expect(VEHICLE_VERIFICATION_NOTICE).toBe("PLEASE VERIFY THE VEHICLE'S PLATE NUMBER AND VEHICLE NAME IF IT MATCHES THE DATA.")});
 it('does not resurrect a trip completed while the first HTTP snapshot is in flight',async()=>{
  vi.useFakeTimers();const handlers=new Map<string,Function>();
  const socket={connected:true,on:(event:string,fn:Function)=>handlers.set(event,fn),off:(event:string)=>handlers.delete(event),emit:vi.fn()};
  let resolve!:(rides:PassengerRide[])=>void;const snapshot=new Promise<PassengerRide[]>(done=>{resolve=done});const changed=vi.fn();
  const tracker=trackOverview({socket,fromStopId:'a',toStopId:'b',fetchRides:()=>snapshot,changed,failed:vi.fn()});
  handlers.get('trip.completed')!({tripId:'a'});resolve([ride('a'),ride('b')]);await tracker.refresh();
  expect(changed.mock.lastCall?.[0].map((value:PassengerRide)=>value.tripId)).toEqual(['b']);tracker.dispose();
 });
});
