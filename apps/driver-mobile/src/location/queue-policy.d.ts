export function sanitizeOptionalTelemetry(value: unknown, minimum: number, maximum: number): number | undefined;
export function sanitizeNativeTelemetry(speed: unknown, heading: unknown): { speed: number | undefined; heading: number | undefined };
export function acknowledgedEventIds(submittedEvents: Array<{ eventId: string }>, results: unknown): Set<string>;
