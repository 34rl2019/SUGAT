import { jsonRequest } from './client';
export type Assignment={id:string;status:'READY'|'ACTIVE';scheduledDepartureAt:string;lastPassedSequence:number;driver:{firstName:string;lastName:string};vehicle:{id:string;type:string;displayName:string;plateNumber:string;bodyNumber?:string};route:{name:string;direction:string;stops:{sequence:number;stop:{id:string;name:string}}[]}};
export const getAssignment=()=>jsonRequest<Assignment|null>('/driver/assignment');
export const startTrip=(id:string)=>jsonRequest<Assignment>(`/driver/trips/${id}/start`,{method:'POST'});
export const completeTrip=(id:string)=>jsonRequest<Assignment>(`/driver/trips/${id}/complete`,{method:'POST'});
