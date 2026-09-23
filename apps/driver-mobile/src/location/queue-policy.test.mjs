import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgedEventIds, sanitizeNativeTelemetry } from './queue-policy.js';

test('omits Android optional telemetry when it is unavailable or outside the API contract', () => {
  assert.deepEqual(sanitizeNativeTelemetry(-1, -1), { speed: undefined, heading: undefined });
  assert.deepEqual(sanitizeNativeTelemetry(Number.NaN, Number.POSITIVE_INFINITY), { speed: undefined, heading: undefined });
  assert.deepEqual(sanitizeNativeTelemetry(251, 361), { speed: undefined, heading: undefined });
  assert.deepEqual(sanitizeNativeTelemetry(12.5, 180), { speed: 12.5, heading: 180 });
});

test('drains only server-acknowledged queue events and keeps retryable or unknown results', () => {
  const submitted = [{ eventId: 'promoted' }, { eventId: 'terminal' }, { eventId: 'retryable' }];
  const acknowledged = acknowledgedEventIds(submitted, [
    { eventId: 'promoted', disposition: 'PROMOTED' },
    { eventId: 'terminal', disposition: 'TERMINAL_INVALID' },
    { eventId: 'retryable', disposition: 'RETRYABLE' },
    { eventId: 'not-submitted', disposition: 'PROMOTED' },
  ]);
  assert.deepEqual([...acknowledged].sort(), ['promoted', 'terminal']);
});
