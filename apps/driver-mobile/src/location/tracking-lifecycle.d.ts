export type AuthoritativeAssignment = { id: string; status: 'SCHEDULED' | 'READY' | 'ACTIVE' } | null;
export type TrackingLifecycleDependencies = {
  localTripId: () => Promise<string | null>;
  trackingRunning: () => Promise<boolean>;
  start: (tripId: string) => Promise<void>;
  stop: () => Promise<void>;
  clearQueue: (tripId: string) => Promise<void>;
};
export function reconcileTrackingLifecycle(assignment: AuthoritativeAssignment, dependencies: TrackingLifecycleDependencies): Promise<{activeTripId:string|null;running:boolean;reconciled:boolean}>;
export function completeTrackingLifecycle<T>(tripId:string, dependencies:{sync:(tripId:string)=>Promise<unknown>;complete:(tripId:string)=>Promise<T>;stop:()=>Promise<void>;clearQueue:(tripId:string)=>Promise<void>}):Promise<T>;
