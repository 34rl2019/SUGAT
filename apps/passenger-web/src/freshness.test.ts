import { describe, expect, it } from 'vitest';
import { deriveLocationFreshness, etaForFreshness, type PassengerEta } from '@sugat/shared-types';

describe('passenger location freshness', () => {
  const now = Date.parse('2026-09-04T12:00:00.000Z');
  it('derives LIVE, STALE, and OFFLINE from recordedAt without socket activity', () => {
    expect(deriveLocationFreshness(new Date(now - 20_000), now)).toBe('LIVE');
    expect(deriveLocationFreshness(new Date(now - 20_001), now)).toBe('STALE');
    expect(deriveLocationFreshness(new Date(now - 600_001), now)).toBe('OFFLINE');
  });
  it('does not mark old authoritative reconnect data LIVE and recovers on fresh data', () => {
    expect(deriveLocationFreshness(new Date(now - 300_000), now)).toBe('STALE');
    expect(deriveLocationFreshness(new Date(now - 700_000), now)).toBe('OFFLINE');
    expect(deriveLocationFreshness(new Date(now - 1_000), now)).toBe('LIVE');
  });
  it('treats malformed timestamps as OFFLINE', () => expect(deriveLocationFreshness('invalid', now)).toBe('OFFLINE'));
  it('downgrades stale ETA and removes offline ETA without changing route-state errors', () => {
    const eta: PassengerEta = { seconds: 300, minutes: 5, display: '~5 min', status: 'AVAILABLE', reason: null };
    expect(etaForFreshness(eta, 'STALE')).toEqual({ ...eta, status: 'APPROXIMATE', reason: 'LOCATION_STALE' });
    expect(etaForFreshness(eta, 'OFFLINE')).toEqual({ seconds: null, minutes: null, display: 'ETA unavailable', status: 'UNAVAILABLE', reason: 'LOCATION_OFFLINE' });
    const passed: PassengerEta = { seconds: null, minutes: null, display: 'Boarding stop passed', status: 'BOARDING_STOP_PASSED', reason: 'STOP_ALREADY_PASSED' };
    expect(etaForFreshness(passed, 'OFFLINE')).toBe(passed);
  });
});
