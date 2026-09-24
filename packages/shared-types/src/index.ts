export type Role = 'DRIVER' | 'ADMIN';
export type VehicleType = 'BUS' | 'VAN' | 'SHUTTLE';
export type TripStatus = 'SCHEDULED' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type Freshness = 'LIVE' | 'STALE' | 'OFFLINE';
export type EtaStatus = 'AVAILABLE' | 'APPROXIMATE' | 'UNAVAILABLE' | 'BOARDING_STOP_PASSED' | 'INVALID_STOP_ORDER';
export interface PassengerEta { seconds:number|null; minutes:number|null; display:string; status:EtaStatus; reason:string|null }
export interface LocationFreshnessPolicy { liveAfterSeconds: number; offlineAfterSeconds: number }
export const DEFAULT_LOCATION_FRESHNESS_POLICY: LocationFreshnessPolicy = { liveAfterSeconds: 20, offlineAfterSeconds: 600 };
export function deriveLocationFreshness(recordedAt: string | Date, now = Date.now(), policy = DEFAULT_LOCATION_FRESHNESS_POLICY): Freshness {
  const timestamp = recordedAt instanceof Date ? recordedAt.getTime() : Date.parse(recordedAt);
  if (!Number.isFinite(timestamp)) return 'OFFLINE';
  const ageSeconds = Math.max(0, (now - timestamp) / 1_000);
  if (ageSeconds <= policy.liveAfterSeconds) return 'LIVE';
  if (ageSeconds <= policy.offlineAfterSeconds) return 'STALE';
  return 'OFFLINE';
}
export function etaForFreshness(eta: PassengerEta | null, freshness: Freshness): PassengerEta | null {
  if (!eta || freshness === 'LIVE' || eta.status === 'BOARDING_STOP_PASSED' || eta.status === 'INVALID_STOP_ORDER') return eta;
  if (freshness === 'OFFLINE') return { seconds: null, minutes: null, display: 'ETA unavailable', status: 'UNAVAILABLE', reason: 'LOCATION_OFFLINE' };
  return eta.status === 'AVAILABLE' ? { ...eta, status: 'APPROXIMATE', reason: 'LOCATION_STALE' } : eta;
}
export interface Coordinate { latitude: number; longitude: number }
export interface LocationEvent extends Coordinate { eventId: string; tripId: string; accuracy: number; speed?: number; heading?: number; recordedAt: string }
export interface Stop extends Coordinate { id:string; name:string; cityMunicipality?:string; province?:string }
export type OccupancyStatus = 'VACANT' | 'FULL';
export interface PassengerLocation extends Coordinate { recordedAt: string; freshness: Freshness; speed?: number | null; heading?: number | null }
export interface PassengerRide {
  tripId: string; vehicleId: string; status: string;
  vehicle: { type: VehicleType; displayName: string; bodyNumber?: string | null };
  route: {
    name: string;
    direction: string;
    stops: { sequence: number; stop: Stop }[];
  };
  boardingStop: Stop; destinationStop: Stop; nextStop: Stop | null;
  distanceKm: number | null; boardingEta: PassengerEta; destinationEta: PassengerEta; remainingTripTime: PassengerEta;
  freshness: Freshness; freshnessPolicy: LocationFreshnessPolicy; lastUpdatedAt: string | null;
  location: PassengerLocation | null; occupancyStatus: OccupancyStatus | null; occupancyUpdatedAt: string | null;
}
export interface PassengerTripDetail {
  id: string; vehicleId: string; status: string;
  vehicle: PassengerRide['vehicle'] & { plateNumber: string; conductionSticker?: string | null };
  route: { id: string; name: string; direction: string; stops: { sequence: number; stop: Stop }[] };
  nextStop: Stop | null; trackingContext: { boardingStopId: string; destinationStopId: string } | null;
  boardingEta: PassengerEta | null; destinationEta: PassengerEta | null; remainingTripTime: PassengerEta | null;
  freshnessPolicy: LocationFreshnessPolicy; location: PassengerLocation | null;
  occupancyStatus: OccupancyStatus | null; occupancyUpdatedAt: string | null;
}
export const VEHICLE_VERIFICATION_NOTICE = "PLEASE VERIFY THE VEHICLE'S PLATE NUMBER AND VEHICLE NAME IF IT MATCHES THE DATA.";
export const occupancyLabel = (status: OccupancyStatus | null | undefined) => status === 'VACANT' || status === 'FULL' ? status : 'SEAT AVAILABILITY UNKNOWN';
export const occupancyColor = (status: OccupancyStatus | null | undefined) => status === 'VACANT' ? '#167344' : status === 'FULL' ? '#b42318' : '#667085';
