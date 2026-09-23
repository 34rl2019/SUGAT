import { assertDatabaseUtc, utcDatabaseUrl } from './database-utc';
import { PrismaService } from './prisma.service';
import { HealthController } from '../health.controller';

describe('UTC database policy', () => {
  it('preserves connection settings and overrides conflicting timezone startup options', () => {
    const url = new URL(utcDatabaseUrl('postgresql://user:secret@localhost/db?schema=public&connection_limit=5&sslmode=require&options=-c%20timezone%3DAmerica%2FLos_Angeles&options=-c%20statement_timeout%3D1000'));
    expect(url.searchParams.get('options')).toBe('-c timezone=America/Los_Angeles -c statement_timeout=1000 -c timezone=UTC');
    expect(url.searchParams.getAll('options')).toHaveLength(1);
    expect(url.searchParams.get('connection_limit')).toBe('5');
    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.searchParams.get('sslmode')).toBe('require');
  });
  it('adds UTC when there are no startup options', () => {
    expect(new URL(utcDatabaseUrl('postgres://user:secret@localhost/db')).searchParams.get('options')).toBe('-c timezone=UTC');
  });
  it('rejects missing or unsupported URLs without exposing credentials', () => {
    for (const value of [undefined, 'not-a-url-secret', 'https://user:secret@example.test']) {
      expect(() => utcDatabaseUrl(value)).toThrow('DATABASE_URL must be a PostgreSQL connection URL');
    }
  });
  it('accepts only a confirmed UTC session and propagates database failures', async () => {
    const db: any = { $queryRaw: jest.fn().mockResolvedValue([{ timezone: 'UTC' }]) };
    await expect(assertDatabaseUtc(db)).resolves.toBeUndefined();
    for (const result of [[{ timezone: 'America/Los_Angeles' }], [{ timezone: 'Asia/Manila' }], []]) {
      db.$queryRaw.mockResolvedValue(result);
      await expect(assertDatabaseUtc(db)).rejects.toThrow('Database session must use UTC');
    }
    db.$queryRaw.mockRejectedValue(new Error('connection unavailable'));
    await expect(assertDatabaseUtc(db)).rejects.toThrow('connection unavailable');
  });
  it('disconnects and rejects startup when the UTC check fails', async () => {
    const db: any = { $connect: jest.fn(), $disconnect: jest.fn(), assertUtc: jest.fn().mockRejectedValue(new Error('unsafe timezone')) };
    await expect(PrismaService.prototype.onModuleInit.call(db)).rejects.toThrow('unsafe timezone');
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
  });
  it('does not report readiness if the UTC check fails', async () => {
    const db: any = { assertUtc: jest.fn().mockRejectedValue(new Error('unsafe timezone')) };
    await expect(new HealthController(db).readiness()).rejects.toThrow('unsafe timezone');
    db.assertUtc.mockResolvedValue(undefined);
    await expect(new HealthController(db).readiness()).resolves.toEqual({ status: 'ready' });
  });
});
