import { Prisma } from '@prisma/client';
import { CanonicalStop, leyteCanonicalStops } from './leyte-stops.data';

export const EXPECTED_COUNTS = { 'Southern Leyte': 19, Leyte: 42, 'Tacloban City': 1 } as const;
export const normalizeStopPart = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
export const canonicalKey = (stop: Pick<CanonicalStop, 'name' | 'cityMunicipality' | 'province'>) => [stop.name, stop.cityMunicipality, stop.province].map(normalizeStopPart).join('|');

export function validateDataset(dataset: CanonicalStop[] = leyteCanonicalStops) {
  const errors: string[] = [];
  if (dataset.length !== 62) errors.push(`Expected 62 records, received ${dataset.length}`);
  for (const [province, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = dataset.filter(stop => stop.province === province).length;
    if (actual !== expected) errors.push(`${province}: expected ${expected}, received ${actual}`);
  }
  const keys = new Set<string>();
  dataset.forEach((stop, index) => {
    const label = `Row ${index + 1} (${stop.name})`;
    if (!stop.name.trim() || !stop.cityMunicipality.trim() || !stop.province.trim()) errors.push(`${label}: name, municipality, and province are required`);
    if (!Number.isFinite(stop.latitude) || stop.latitude < -90 || stop.latitude > 90) errors.push(`${label}: invalid latitude ${stop.latitude}`);
    if (!Number.isFinite(stop.longitude) || stop.longitude < -180 || stop.longitude > 180) errors.push(`${label}: invalid longitude ${stop.longitude}`);
    if (stop.latitude < 9.5 || stop.latitude > 11.7 || stop.longitude < 124.1 || stop.longitude > 125.5) errors.push(`${label}: coordinate is outside the Leyte/Southern Leyte sanity bounds`);
    const key = canonicalKey(stop); if (keys.has(key)) errors.push(`${label}: duplicate canonical key`); keys.add(key);
  });
  if (errors.length) throw new Error(`Canonical stop dataset validation failed:\n${errors.join('\n')}`);
  return true;
}

export function assertImportAllowed(nodeEnv: string | undefined, args: string[]) {
  const allowed = new Set(['--dry-run', '--confirm-production-import']);
  const unknown = args.filter(arg => !allowed.has(arg));
  if (unknown.length) throw new Error(`Unknown importer argument(s): ${unknown.join(', ')}`);
  if (nodeEnv === 'production' && !args.includes('--dry-run') && !args.includes('--confirm-production-import')) throw new Error('Production import aborted: --confirm-production-import is required');
}

type ExistingStop = CanonicalStop & { id: string; active: boolean };
export type ImportAction = { kind: 'inserted' | 'updated' | 'skipped'; canonical: CanonicalStop; existing?: ExistingStop; data?: Record<string, unknown> };
const canonicalFields = (stop: CanonicalStop) => ({ name: stop.name, cityMunicipality: stop.cityMunicipality, province: stop.province, latitude: stop.latitude, longitude: stop.longitude });

export function buildImportPlan(existing: ExistingStop[], dataset: CanonicalStop[] = leyteCanonicalStops): ImportAction[] {
  validateDataset(dataset);
  const grouped = new Map<string, ExistingStop[]>();
  for (const stop of existing) { const key = canonicalKey(stop); grouped.set(key, [...(grouped.get(key) ?? []), stop]); }
  return dataset.map(canonical => {
    const matches = grouped.get(canonicalKey(canonical)) ?? [];
    if (matches.length > 1) throw new Error(`Multiple existing stops match canonical key: ${canonicalKey(canonical)}`);
    if (!matches.length) return { kind: 'inserted', canonical, data: canonicalFields(canonical) };
    const current = matches[0], data = canonicalFields(canonical);
    const changed = Object.entries(data).some(([key, value]) => current[key as keyof ExistingStop] !== value);
    return { kind: changed ? 'updated' : 'skipped', canonical, existing: current, ...(changed ? { data } : {}) };
  });
}

const provinces = Object.keys(EXPECTED_COUNTS);
const findExisting = (db: any) => db.stop.findMany({ where: { province: { in: provinces } }, select: { id: true, name: true, cityMunicipality: true, province: true, latitude: true, longitude: true, active: true } });
export type ImportResult = { dryRun: boolean; actions: ImportAction[]; activeCanonicalStops: number };

export async function importCanonicalStops(db: any, dryRun: boolean): Promise<ImportResult> {
  validateDataset();
  if (dryRun) { const actions = buildImportPlan(await findExisting(db)); return { dryRun: true, actions, activeCanonicalStops: actions.filter(action => action.kind === 'inserted' || action.existing?.active).length }; }
  return db.$transaction(async (transaction: any) => {
    const actions = buildImportPlan(await findExisting(transaction));
    for (const action of actions) {
      if (action.kind === 'inserted') await transaction.stop.create({ data: { ...action.data, active: true } });
      if (action.kind === 'updated') await transaction.stop.update({ where: { id: action.existing!.id }, data: action.data });
    }
    const current = await findExisting(transaction), canonicalKeys = new Set(leyteCanonicalStops.map(canonicalKey));
    return { dryRun: false, actions, activeCanonicalStops: current.filter((stop: ExistingStop) => stop.active && canonicalKeys.has(canonicalKey(stop))).length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
}

export function formatImportSummary(result: ImportResult) {
  const count = (kind: ImportAction['kind'], province?: string) => result.actions.filter(action => action.kind === kind && (!province || action.canonical.province === province)).length;
  return [`Mode: ${result.dryRun ? 'DRY RUN — no writes performed' : 'CONFIRMED IMPORT'}`, 'Expected: 62', `Inserted: ${count('inserted')}`, `Updated: ${count('updated')}`, `Skipped: ${count('skipped')}`, 'Failed: 0', `Total active canonical stops after import: ${result.activeCanonicalStops}`, '', 'Breakdown:', ...Object.entries(EXPECTED_COUNTS).map(([province, expected]) => `${province}: expected ${expected}, inserted ${count('inserted', province)}, updated ${count('updated', province)}, skipped ${count('skipped', province)}`), '', 'Needs future visual review:', ...leyteCanonicalStops.filter(stop => stop.needsVisualReview).map(stop => `- ${stop.cityMunicipality}`)].join('\n');
}
