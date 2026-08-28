import { Prisma } from '@prisma/client';
import { CanonicalStop, regionVIIICanonicalStops } from './leyte-stops.data';

export const EXPECTED_COUNTS = { Leyte: 43, 'Southern Leyte': 19, Biliran: 8, Samar: 26, 'Eastern Samar': 23, 'Northern Samar': 24 } as const;
export const EXPECTED_TOTAL = 143;
export const normalizeStopPart = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const canonicalProvince = (province: string) => normalizeStopPart(province) === 'tacloban city' ? 'leyte' : normalizeStopPart(province);
export const canonicalKey = (stop: { cityMunicipality: string; province: string }) => `${normalizeStopPart(stop.cityMunicipality)}|${canonicalProvince(stop.province)}`;
export const coordinateKey = (stop: Pick<CanonicalStop, 'latitude' | 'longitude'>) => `${stop.latitude.toFixed(6)}|${stop.longitude.toFixed(6)}`;

export function duplicateCoordinates(dataset: CanonicalStop[] = regionVIIICanonicalStops) {
  const grouped = new Map<string, CanonicalStop[]>();
  for (const stop of dataset) { const key = coordinateKey(stop); grouped.set(key, [...(grouped.get(key) ?? []), stop]); }
  return [...grouped.entries()].filter(([, stops]) => stops.length > 1).map(([coordinate, stops]) => ({ coordinate, stops }));
}

export function validateDataset(dataset: CanonicalStop[] = regionVIIICanonicalStops) {
  const errors: string[] = [];
  if (dataset.length !== EXPECTED_TOTAL) errors.push(`Expected ${EXPECTED_TOTAL} records, received ${dataset.length}`);
  for (const [province, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = dataset.filter(stop => stop.province === province).length;
    if (actual !== expected) errors.push(`${province}: expected ${expected}, received ${actual}`);
  }
  const keys = new Set<string>(), codes = new Set<string>();
  dataset.forEach((stop, index) => {
    const label = `Row ${index + 1} (${stop.name})`;
    if (!/^\d{10}$/.test(stop.code)) errors.push(`${label}: invalid PSGC code ${stop.code}`);
    if (codes.has(stop.code)) errors.push(`${label}: duplicate PSGC code`); codes.add(stop.code);
    if (!stop.name.trim() || !stop.cityMunicipality.trim() || !stop.province.trim()) errors.push(`${label}: name, municipality, and province are required`);
    if (stop.name !== `${stop.cityMunicipality} ${stop.province}`.toUpperCase()) errors.push(`${label}: display name must be municipality/city plus province`);
    if (/\b(?:TOWN|CITY|MUNICIPAL)[ -]CENTER\b/i.test(stop.name)) errors.push(`${label}: generic center label is prohibited`);
    if (stop.region !== 'Eastern Visayas' || stop.active !== true) errors.push(`${label}: canonical region/active metadata is invalid`);
    if (!Number.isFinite(stop.latitude) || stop.latitude < -90 || stop.latitude > 90) errors.push(`${label}: invalid latitude ${stop.latitude}`);
    if (!Number.isFinite(stop.longitude) || stop.longitude < -180 || stop.longitude > 180) errors.push(`${label}: invalid longitude ${stop.longitude}`);
    if (stop.latitude < 9.3 || stop.latitude > 13 || stop.longitude < 123.7 || stop.longitude > 126) errors.push(`${label}: coordinate is outside Region VIII sanity bounds`);
    const key = canonicalKey(stop); if (keys.has(key)) errors.push(`${label}: duplicate municipality/province`); keys.add(key);
  });
  for (const duplicate of duplicateCoordinates(dataset)) errors.push(`Duplicate coordinate ${duplicate.coordinate}: ${duplicate.stops.map(stop => stop.name).join(', ')}`);
  if (errors.length) throw new Error(`Canonical stop dataset validation failed:\n${errors.join('\n')}`);
  return true;
}

export function assertImportAllowed(nodeEnv: string | undefined, args: string[]) {
  const allowed = new Set(['--dry-run', '--confirm-production-import']);
  const unknown = args.filter(arg => !allowed.has(arg));
  if (unknown.length) throw new Error(`Unknown importer argument(s): ${unknown.join(', ')}`);
  if (nodeEnv === 'production' && !args.includes('--dry-run') && !args.includes('--confirm-production-import')) throw new Error('Production import aborted: --confirm-production-import is required');
}

type ExistingStop = Pick<CanonicalStop, 'name' | 'cityMunicipality' | 'latitude' | 'longitude'> & { id: string; province: string; active: boolean };
export type ImportAction = { kind: 'inserted' | 'updated' | 'skipped'; canonical: CanonicalStop; existing?: ExistingStop; data?: Record<string, unknown> };
const canonicalFields = (stop: CanonicalStop) => ({ name: stop.name, cityMunicipality: stop.cityMunicipality, province: stop.province, latitude: stop.latitude, longitude: stop.longitude });

export function buildImportPlan(existing: ExistingStop[], dataset: CanonicalStop[] = regionVIIICanonicalStops): ImportAction[] {
  validateDataset(dataset);
  const grouped = new Map<string, ExistingStop[]>();
  for (const stop of existing) { const key = canonicalKey(stop); grouped.set(key, [...(grouped.get(key) ?? []), stop]); }
  return dataset.map(canonical => {
    const matches = grouped.get(canonicalKey(canonical)) ?? [];
    if (matches.length > 1) throw new Error(`Multiple existing stops match canonical municipality: ${canonicalKey(canonical)}`);
    if (!matches.length) return { kind: 'inserted', canonical, data: canonicalFields(canonical) };
    const current = matches[0], data = canonicalFields(canonical);
    const changed = Object.entries(data).some(([key, value]) => current[key as keyof ExistingStop] !== value);
    return { kind: changed ? 'updated' : 'skipped', canonical, existing: current, ...(changed ? { data } : {}) };
  });
}

const provinces = [...Object.keys(EXPECTED_COUNTS), 'Tacloban City'];
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
    const current = await findExisting(transaction), canonicalKeys = new Set(regionVIIICanonicalStops.map(canonicalKey));
    return { dryRun: false, actions, activeCanonicalStops: current.filter((stop: ExistingStop) => stop.active && canonicalKeys.has(canonicalKey(stop))).length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
}
export function formatImportSummary(result: ImportResult) {
  const count = (kind: ImportAction['kind'], province?: string) => result.actions.filter(action => action.kind === kind && (!province || action.canonical.province === province)).length;
  return [`Mode: ${result.dryRun ? 'DRY RUN — no writes performed' : 'CONFIRMED IMPORT'}`, `Expected: ${EXPECTED_TOTAL}`, `Inserted: ${count('inserted')}`, `Updated: ${count('updated')}`, `Skipped: ${count('skipped')}`, 'Failed: 0', `Total active canonical stops after import: ${result.activeCanonicalStops}`, '', 'Breakdown:', ...Object.entries(EXPECTED_COUNTS).map(([province, expected]) => `${province}: expected ${expected}, inserted ${count('inserted', province)}, updated ${count('updated', province)}, skipped ${count('skipped', province)}`), '', `Duplicate coordinates: ${duplicateCoordinates().length}`, 'Missing/unverified coordinates: 0'].join('\n');
}
