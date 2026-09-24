import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { assertImportAllowed, formatImportSummary, importCanonicalStops, validateDataset } from '../src/imports/leyte-stops.importer';

ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'] });
async function main() {
  const args = process.argv.slice(2); assertImportAllowed(process.env.NODE_ENV, args); validateDataset();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient();
  try { console.log(formatImportSummary(await importCanonicalStops(prisma, args.includes('--dry-run')))); } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
