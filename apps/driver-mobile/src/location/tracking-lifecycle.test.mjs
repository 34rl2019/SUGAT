import assert from 'node:assert/strict';
import test from 'node:test';
import { completeTrackingLifecycle, reconcileTrackingLifecycle } from './tracking-lifecycle.js';

function lifecycle({ localTripId = null, running = false } = {}) {
  const calls = [];
  const dependencies = {
    localTripId: async () => localTripId,
    trackingRunning: async () => running,
    start: async id => { calls.push(`start:${id}`); localTripId = id; running = true; },
    stop: async () => { calls.push('stop'); localTripId = null; running = false; },
    clearQueue: async id => { calls.push(`clear:${id}`); },
  };
  return { calls, dependencies };
}

test('starts an active authoritative trip only when the tracker is stopped', async () => {
  const stopped = lifecycle();
  await reconcileTrackingLifecycle({ id: 'trip-1', status: 'ACTIVE' }, stopped.dependencies);
  assert.deepEqual(stopped.calls, ['start:trip-1']);

  const running = lifecycle({ localTripId: 'trip-1', running: true });
  await reconcileTrackingLifecycle({ id: 'trip-1', status: 'ACTIVE' }, running.dependencies);
  assert.deepEqual(running.calls, []);
});

test('idempotently stops and clears stale local state when no active trip exists', async () => {
  const stale = lifecycle({ localTripId: 'trip-old', running: true });
  await reconcileTrackingLifecycle(null, stale.dependencies);
  await reconcileTrackingLifecycle(null, stale.dependencies);
  assert.deepEqual(stale.calls, ['stop', 'clear:trip-old']);
});

test('replaces a stale tracker when a different trip is authoritative', async () => {
  const stale = lifecycle({ localTripId: 'trip-old', running: true });
  await reconcileTrackingLifecycle({ id: 'trip-new', status: 'ACTIVE' }, stale.dependencies);
  assert.deepEqual(stale.calls, ['stop', 'clear:trip-old', 'start:trip-new']);
});

test('does not stop tracking when completion API fails', async () => {
  const calls = [];
  await assert.rejects(completeTrackingLifecycle('trip-1', {
    sync: async () => { calls.push('sync'); },
    complete: async () => { calls.push('complete'); throw new Error('offline'); },
    stop: async () => { calls.push('stop'); },
    clearQueue: async () => { calls.push('clear'); },
  }), /offline/);
  assert.deepEqual(calls, ['sync', 'complete']);
});

test('completion success stops tracking and clears the completed queue once', async () => {
  const calls = [];
  await completeTrackingLifecycle('trip-1', {
    sync: async id => { calls.push(`sync:${id}`); },
    complete: async id => { calls.push(`complete:${id}`); },
    stop: async () => { calls.push('stop'); },
    clearQueue: async id => { calls.push(`clear:${id}`); },
  });
  assert.deepEqual(calls, ['sync:trip-1', 'complete:trip-1', 'stop', 'clear:trip-1']);
});

test('clears non-authoritative queued coordinates even if native stop reports an error', async () => {
  const calls=[];
  await assert.rejects(reconcileTrackingLifecycle(null,{
    localTripId:async()=> 'trip-old',trackingRunning:async()=>true,
    start:async()=>{},stop:async()=>{calls.push('stop');throw new Error('native stop failed')},
    clearQueue:async id=>{calls.push(`clear:${id}`)},
  }),/native stop failed/);
  assert.deepEqual(calls,['stop','clear:trip-old']);
});

test('failed queue upload still completes, then stops and clears',async()=>{
 const calls=[];
 await completeTrackingLifecycle('trip',{sync:async()=>{calls.push('sync');throw Error('upload failed')},complete:async()=>calls.push('complete'),stop:async()=>calls.push('stop'),clearQueue:async()=>calls.push('clear')});
 assert.deepEqual(calls,['sync','complete','stop','clear']);
});
