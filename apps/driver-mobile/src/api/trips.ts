import { jsonRequest } from './client';
export type Assignment={id:string;status:'READY'|'ACTIVE';scheduledDepartureAt:string;lastPassedSequence:number;compliance:{eligible:boolean;code:string|null;message:string|null;licenseValidity:'VALID'|'EXPIRING_SOON'|'EXPIRING_CRITICAL'|'EXPIRED'|'NOT_ON_FILE';licenseDaysRemaining:number|null};driver:{firstName:string;lastName:string};vehicle:{id:string;type:string;displayName:string;plateNumber:string;bodyNumber?:string};route:{name:string;direction:string;stops:{sequence:number;stop:{id:string;name:string}}[]}};
export const getAssignment=()=>jsonRequest<Assignment|null>('/driver/assignment');
export const startTrip=(id:string)=>jsonRequest<Assignment>(`/driver/trips/${id}/start`,{method:'POST'});
export const completeTrip=(id:string)=>jsonRequest<Assignment>(`/driver/trips/${id}/complete`,{method:'POST'});
