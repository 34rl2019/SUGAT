import type { PrismaClient } from '@prisma/client';

/** Apply to every new pooled connection, not just one connection via SET TIME ZONE. */
export function utcDatabaseUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
  } catch {
    // Never include a connection URL (and its credentials) in diagnostics.
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const options = url.searchParams.getAll('options').join(' ').trim();
  url.searchParams.set('options', `${options ? options + ' ' : ''}-c timezone=UTC`);
  return url.toString();
}

export async function assertDatabaseUtc(db: Pick<PrismaClient, '$queryRaw'>): Promise<void> {
  const rows = await db.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone') AS timezone`;
  if (rows.length !== 1 || rows[0].timezone !== 'UTC') {
    throw new Error('Database session must use UTC; refusing unsafe timestamp handling');
  }
}
