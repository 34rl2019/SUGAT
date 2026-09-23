import { deriveLocationFreshness, etaForFreshness, type OccupancyStatus, type PassengerLocation, type PassengerRide } from '../../shared-types/src';

type Socket = {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
};
export type RideState = Record<string, PassengerRide>;
const time = (value: string | null | undefined) => value ? Date.parse(value) || 0 : 0;

export function reconcileRides(current: RideState, snapshot: PassengerRide[]): RideState {
  return Object.fromEntries(snapshot.map(ride => {
    const previous = current[ride.tripId];
    return [ride.tripId, { ...ride,
      ...(previous && time(previous.location?.recordedAt) > time(ride.location?.recordedAt) ? { location: previous.location, lastUpdatedAt: previous.location?.recordedAt ?? null } : {}),
      ...(previous && time(previous.occupancyUpdatedAt) > time(ride.occupancyUpdatedAt) ? { occupancyStatus: previous.occupancyStatus, occupancyUpdatedAt: previous.occupancyUpdatedAt } : {}),
    }];
  }));
}
export function updateRideLocation(state: RideState, event: PassengerLocation & { tripId: string }): RideState {
  const ride = state[event.tripId];
  if (!ride || !Number.isFinite(event.latitude) || !Number.isFinite(event.longitude) || time(event.recordedAt) <= time(ride.location?.recordedAt)) return state;
  return { ...state, [event.tripId]: { ...ride, location: event, lastUpdatedAt: event.recordedAt } };
}
export function updateRideOccupancy(state: RideState, event: { tripId: string; occupancyStatus: OccupancyStatus; updatedAt: string }): RideState {
  const ride = state[event.tripId];
  if (!ride || !['VACANT', 'FULL'].includes(event.occupancyStatus) || time(event.updatedAt) < time(ride.occupancyUpdatedAt) || !time(event.updatedAt)) return state;
  return { ...state, [event.tripId]: { ...ride, occupancyStatus: event.occupancyStatus, occupancyUpdatedAt: event.updatedAt } };
}
export function ageRides(state: RideState, now = Date.now()): PassengerRide[] {
  return Object.values(state).map(ride => {
    const freshness = ride.location ? deriveLocationFreshness(ride.location.recordedAt, now, ride.freshnessPolicy) : 'OFFLINE';
    return { ...ride, freshness, location: ride.location ? { ...ride.location, freshness } : null,
      boardingEta: etaForFreshness(ride.boardingEta, freshness)!, destinationEta: etaForFreshness(ride.destinationEta, freshness)!, remainingTripTime: etaForFreshness(ride.remainingTripTime, freshness)!,
    };
  });
}

/** Shared Web/Mobile overview lifecycle. HTTP is authoritative for membership and ETA. */
export function trackOverview(options: {
  socket: Socket; fromStopId: string; toStopId: string; fetchRides: () => Promise<PassengerRide[]>;
  changed: (rides: PassengerRide[]) => void; failed: (message: string) => void; completed?: (tripId: string) => void;
}) {
  let state: RideState = {}, disposed = false, hasSnapshot = false, inFlight: Promise<void> | null = null;
  const ended = new Set<string>();
  const publish = () => { if (!disposed && hasSnapshot) options.changed(ageRides(state)); };
  const subscribe = () => {
    if (disposed || !options.socket.connected) return;
    options.socket.emit('trips.subscribe', { fromStopId: options.fromStopId, toStopId: options.toStopId }, (ack: { ok: boolean; tripIds?: string[]; message?: string }) => {
      if (disposed) return;
      if (!ack?.ok) options.failed(ack?.message ?? 'Live updates are unavailable. Retrying with periodic updates.');
    });
  };
  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = options.fetchRides().then(rides => {
      if (disposed) return;
      state = reconcileRides(state, rides.filter(ride => !ended.has(ride.tripId)));
      hasSnapshot = true;
      publish(); subscribe();
    }).catch(() => { if (!disposed) options.failed('Updates are temporarily unavailable. Showing last known locations.'); })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const connected = () => { subscribe(); void refresh(); };
  const location = (event: PassengerLocation & { tripId: string }) => { state = updateRideLocation(state, event); publish(); };
  const occupancy = (event: { tripId: string; occupancyStatus: OccupancyStatus; updatedAt: string }) => { state = updateRideOccupancy(state, event); publish(); };
  const completed = (event: { tripId: string }) => {
    // A room can be joined before the first HTTP snapshot returns.
    ended.add(event.tripId);
    if (!state[event.tripId]) return;
    delete state[event.tripId]; publish(); options.completed?.(event.tripId); void refresh();
  };
  options.socket.on('connect', connected);
  options.socket.on('trip.location.updated', location);
  options.socket.on('trip.occupancy.updated', occupancy);
  options.socket.on('trip.completed', completed);
  const aging = setInterval(publish, 5_000);
  // Also discovers new trips and removes passed/nonmatching trips when sockets are healthy.
  const fallback = setInterval(() => void refresh(), 30_000);
  void refresh();
  return { refresh, dispose() {
    disposed = true; clearInterval(aging); clearInterval(fallback);
    options.socket.off('connect', connected); options.socket.off('trip.location.updated', location);
    options.socket.off('trip.occupancy.updated', occupancy); options.socket.off('trip.completed', completed);
  } };
}
