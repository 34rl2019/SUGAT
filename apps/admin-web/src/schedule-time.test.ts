import { describe, expect, it } from 'vitest';
import { manilaScheduleInstant } from './schedule-time';

describe('Asia/Manila schedule input', () => {
  it('converts a Philippine local time to its absolute UTC instant', () => expect(manilaScheduleInstant('2026-09-05T08:00')).toBe('2026-09-05T00:00:00.000Z'));
  it('handles the previous UTC calendar day at Philippine midnight', () => expect(manilaScheduleInstant('2026-09-05T00:00')).toBe('2026-09-04T16:00:00.000Z'));
});
