// Validate against the latest server-provided authorized operations, not raw IDs.
export function startSelection(operations, routeId, vehicleId, startStopId, destinationStopId) {
  const route = operations?.routes.find(route => route.id === routeId);
  if (!route || !operations.vehicles.some(vehicle => vehicle.id === vehicleId)) return null;
  if (!startStopId || !destinationStopId || startStopId === destinationStopId) return null;
  const start = route.stops.find(stop => stop.stopId === startStopId);
  const destination = route.stops.find(stop => stop.stopId === destinationStopId);
  if (!start?.boardingAllowed || !destination?.dropoffAllowed || start.sequence >= destination.sequence) return null;
  if (![startStopId, destinationStopId].every(id => operations.stops.some(stop => stop.id === id))) return null;
  return { routeId, vehicleId, startStopId, destinationStopId };
}
