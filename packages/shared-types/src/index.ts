export type Role = 'DRIVER' | 'ADMIN';
export type VehicleType = 'BUS' | 'VAN' | 'SHUTTLE';
export type TripStatus = 'SCHEDULED' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type Freshness = 'LIVE' | 'STALE' | 'OFFLINE';
export interface Coordinate { latitude: number; longitude: number }
export interface LocationEvent extends Coordinate { eventId: string; tripId: string; accuracy: number; speed?: number; heading?: number; recordedAt: string }
export interface Stop extends Coordinate { id:string; name:string; cityMunicipality?:string; province?:string }
