import { jsonRequest } from './client';

export type DriverCompliance = {
  eligible: boolean;
  code: string | null;
  message: string | null;
  licenseValidity:
    | 'VALID'
    | 'EXPIRING_SOON'
    | 'EXPIRING_CRITICAL'
    | 'EXPIRED'
    | 'NOT_ON_FILE';
  licenseDaysRemaining: number | null;
};

export type Vehicle = {
  id: string;
  type: string;
  displayName: string;
  plateNumber: string;
  conductionSticker?: string | null;
  bodyNumber?: string | null;
  capacity?: number | null;
  defaultRouteId?: string | null;
};

export type OperationRouteStop = {
  stopId: string;
  sequence: number;
  boardingAllowed: boolean;
  dropoffAllowed: boolean;
};

export type Route = {
  id: string;
  name: string;
  direction: string;
  active?: boolean;
  stops: OperationRouteStop[];
};

export type OperationStop = {
  id: string;
  name: string;
  cityMunicipality: string | null;
  province: string | null;
};

export type Assignment = {
  id: string;
  occupancyStatus?: 'VACANT' | 'FULL' | null;
  status:
    | 'SCHEDULED'
    | 'READY'
    | 'ACTIVE';
  scheduledDepartureAt: string | null;
  lastPassedSequence: number;
  vehicle: {
    id: string;
    type: string;
    displayName: string;
    plateNumber: string;
    conductionSticker?: string | null;
    bodyNumber?: string | null;
  };
  route: {
    id?: string;
    name: string;
    direction: string;
    stops: {
      sequence: number;
      stop: {
        id: string;
        name: string;
      };
    }[];
  };
};

export type Operations = {
  vehicles: Vehicle[];
  vehicle?: Vehicle | null;
  route?: Route | null;
  routes: Route[];
  stops: OperationStop[];
  activeTrip: Assignment | null;
  compliance: DriverCompliance;
  canStart?: boolean;
};

export type StartTripInput = {
  routeId: string;
  vehicleId?: string;
  startStopId: string;
  destinationStopId: string;
};

export type StartedTrip = {
  id: string;
  driverId: string;
  vehicleId: string;
  routeId: string;
  status: 'ACTIVE';
  startedAt: string;
  occupancyStatus: 'VACANT';
  occupancyUpdatedAt: string;
};

export type OccupancyUpdate = {
  tripId: string;
  vehicleId: string;
  occupancyStatus: 'VACANT' | 'FULL';
  updatedAt: string;
};

export type CompletedTrip = {
  id: string;
  status: 'COMPLETED';
  endedAt: string;
};

export const getAssignment = () =>
  jsonRequest<Assignment | null>(
    '/driver/assignment',
  );

export const getOperations = () =>
  jsonRequest<Operations>(
    '/driver/operations',
  );

export const startTrip = (
  input: StartTripInput,
) =>
  jsonRequest<StartedTrip>(
    '/driver/trips/start',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );

export const setOccupancy = (
  id: string,
  occupancyStatus: 'VACANT' | 'FULL',
) =>
  jsonRequest<OccupancyUpdate>(
    `/driver/trips/${id}/occupancy`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        occupancyStatus,
      }),
    },
  );

export const completeTrip = (
  id: string,
) =>
  jsonRequest<CompletedTrip>(
    `/driver/trips/${id}/complete`,
    {
      method: 'POST',
    },
  );
