/** Integration runners must never inherit a production or ordinary development database. */
export function assertIsolatedValidation(requireRedis = false) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Validation requires NODE_ENV=test');
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '55432' ||
      !/^\/(sugat_e2e_test|sugat_pilot_validation_\d+)$/.test(database.pathname)) {
    throw new Error('Validation requires a dedicated localhost:55432 validation database');
  }
  if (requireRedis) {
    const redis = new URL(process.env.REDIS_URL ?? '');
    if (!['localhost', '127.0.0.1'].includes(redis.hostname) || redis.port !== '56379') {
      throw new Error('Validation requires isolated localhost:56379 Redis');
    }
  }
}
