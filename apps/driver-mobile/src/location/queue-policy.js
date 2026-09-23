const removableDispositions = new Set(['PROMOTED', 'STALE', 'DUPLICATE', 'SUSPICIOUS', 'TERMINAL_INVALID']);

export function sanitizeOptionalTelemetry(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

export function sanitizeNativeTelemetry(speed, heading) {
  return {
    speed: sanitizeOptionalTelemetry(speed, 0, 250),
    heading: sanitizeOptionalTelemetry(heading, 0, 360),
  };
}

export function acknowledgedEventIds(submittedEvents, results) {
  const submittedIds = new Set(submittedEvents.map(event => event.eventId));
  return new Set((Array.isArray(results) ? results : [])
    .filter(result => submittedIds.has(result?.eventId) && removableDispositions.has(result?.disposition))
    .map(result => result.eventId));
}
