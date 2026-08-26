export const livePolicy = {
  liveAfterSeconds: Number(process.env.LIVE_AFTER_SECONDS ?? 20),
  staleAfterSeconds: Number(process.env.GPS_STALE_AFTER_SECONDS ?? process.env.STALE_AFTER_SECONDS ?? 120),
  offlineAfterSeconds: Number(process.env.OFFLINE_AFTER_SECONDS ?? 600),
  approachingStopMeters: Number(process.env.APPROACHING_STOP_METERS ?? 1500),
  arrivedStopMeters: Number(process.env.ARRIVED_STOP_METERS ?? 150),
};
export type Freshness = 'LIVE'|'STALE'|'OFFLINE';
export function locationFreshness(at:Date):Freshness { const age=(Date.now()-at.getTime())/1000; if(age<=livePolicy.liveAfterSeconds)return'LIVE'; if(age<=livePolicy.offlineAfterSeconds)return'STALE'; return'OFFLINE'; }
