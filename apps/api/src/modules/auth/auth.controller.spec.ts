import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from './auth.controller';

describe('AuthController security policies', () => {
  it.each([
    ['login', 5],
    ['refresh', 20],
    ['changePassword', 5],
  ])('applies a dedicated auth throttle to %s', (method, limit) => {
    const handler = AuthController.prototype[method as keyof AuthController];
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}auth`, handler)).toBe(limit);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}auth`, handler)).toBe(60_000);
  });
});
