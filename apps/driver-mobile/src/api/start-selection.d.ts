import type { Operations } from './trips';
export type StartSelection = { routeId: string; vehicleId: string; startStopId: string; destinationStopId: string };
export function startSelection(operations: Operations | null, routeId: string, vehicleId: string, startStopId: string, destinationStopId: string): StartSelection | null;
