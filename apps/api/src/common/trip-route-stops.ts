export function tripRouteStops<
  T extends { stopId: string; sequence: number }
>(
  trip: {
    startStopId?: string | null;
    destinationStopId?: string | null;
    route: {
      stops: T[];
    };
  },
): T[] {
  const stops = trip.route.stops;

  // Historical/scheduled trip operating the full route.
  if (!trip.startStopId && !trip.destinationStopId) {
    return stops;
  }

  const start = stops.find(
    stop => stop.stopId === trip.startStopId,
  );

  const end = stops.find(
    stop => stop.stopId === trip.destinationStopId,
  );

  if (
    !start ||
    !end ||
    start.sequence >= end.sequence
  ) {
    return [];
  }

  return stops.filter(
    stop =>
      stop.sequence >= start.sequence &&
      stop.sequence <= end.sequence,
  );
}

// Load the same authoritative segment in every active-trip consumer.
export const startedSegmentEvents = {
  where: { type: 'STARTED' as const },
  orderBy: { createdAt: 'desc' as const },
  take: 1,
};

export function operatingTrip<T extends {
  events?: { metadata: unknown }[];
  lastPassedSequence: number;
  route: { stops: { stopId: string; sequence: number }[] };
}>(trip: T): T & { startStopId: string | null; destinationStopId: string | null } {
  const value = trip.events?.[0]?.metadata;
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const startStopId = typeof metadata.startStopId === 'string' ? metadata.startStopId : null;
  const destinationStopId = typeof metadata.destinationStopId === 'string' ? metadata.destinationStopId : null;
  const stops = tripRouteStops({ ...trip, startStopId, destinationStopId });
  return {
    ...trip, startStopId, destinationStopId,
    lastPassedSequence: Math.max(trip.lastPassedSequence, (stops[0]?.sequence ?? 1) - 1),
    route: { ...trip.route, stops } as T['route'],
  };
}
