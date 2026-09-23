import { regionVIIICanonicalStops } from './leyte-stops.data';
import { assertImportAllowed, buildImportPlan, duplicateCoordinates, importCanonicalStops, validateDataset } from './leyte-stops.importer';

const existing = () => regionVIIICanonicalStops.map((stop, index) => ({ name: stop.name, cityMunicipality: stop.cityMunicipality, province: stop.province, latitude: stop.latitude, longitude: stop.longitude, id: `stop-${index}`, active: true }));
const find = (name: string) => regionVIIICanonicalStops.find(stop => stop.name === name);
const search = (query: string) => regionVIIICanonicalStops.filter(stop => `${stop.name} ${stop.cityMunicipality} ${stop.province}`.toLocaleLowerCase('en').includes(query.trim().toLocaleLowerCase('en')));

describe('Region VIII canonical stop importer', () => {
  it('contains every current Region VIII city and municipality', () => {
    expect(regionVIIICanonicalStops).toHaveLength(143);
    expect(regionVIIICanonicalStops.filter(stop => stop.province === 'Leyte')).toHaveLength(43);
    expect(regionVIIICanonicalStops.filter(stop => stop.province === 'Southern Leyte')).toHaveLength(19);
    expect(regionVIIICanonicalStops.filter(stop => stop.province === 'Biliran')).toHaveLength(8);
    expect(regionVIIICanonicalStops.filter(stop => stop.province === 'Samar')).toHaveLength(26);
    expect(regionVIIICanonicalStops.filter(stop => stop.province === 'Eastern Samar')).toHaveLength(23);
    expect(regionVIIICanonicalStops.filter(stop => stop.province === 'Northern Samar')).toHaveLength(24);
    expect(validateDataset()).toBe(true);
  });

  it.each(['SOGOD SOUTHERN LEYTE', 'BATO LEYTE', 'HILONGOS LEYTE', 'NAVAL BILIRAN', 'CATBALOGAN CITY SAMAR', 'BORONGAN CITY EASTERN SAMAR', 'CATARMAN NORTHERN SAMAR'])('includes %s', name => {
    expect(find(name)).toBeDefined();
  });

  it('uses stable unique PSGC codes and municipality-plus-province identity', () => {
    expect(new Set(regionVIIICanonicalStops.map(stop => stop.code)).size).toBe(143);
    expect(find('SAN ISIDRO LEYTE')?.code).not.toBe(find('SAN ISIDRO NORTHERN SAMAR')?.code);
  });

  it('has no generic center labels, duplicate localities, or duplicate coordinates', () => {
    expect(regionVIIICanonicalStops.some(stop => /(?:TOWN|CITY|MUNICIPAL)[ -]CENTER/i.test(stop.name))).toBe(false);
    expect(find('SOGOD-TOWN CENTER')).toBeUndefined();
    expect(find('BATO-TOWN CENTER')).toBeUndefined();
    expect(duplicateCoordinates()).toHaveLength(0);
  });

  it('rejects invalid and out-of-region coordinates before import', () => {
    const invalid = regionVIIICanonicalStops.map(stop => ({ ...stop })); invalid[0].latitude = 91;
    expect(() => validateDataset(invalid)).toThrow(/invalid latitude/);
    invalid[0].latitude = 8;
    expect(() => validateDataset(invalid)).toThrow(/outside Region VIII/);
  });

  it('supports case-insensitive partial passenger search by municipality and province', () => {
    expect(search('sogod').map(stop => stop.name)).toContain('SOGOD SOUTHERN LEYTE');
    expect(search('GUIUAN').map(stop => stop.name)).toContain('GUIUAN EASTERN SAMAR');
    expect(search('northern samar').map(stop => stop.name)).toHaveLength(24);
  });

  it('provides province-qualified labels for admin route selection', () => {
    expect(find('SAN ISIDRO LEYTE')?.name).toBe('SAN ISIDRO LEYTE');
    expect(find('SAN ISIDRO NORTHERN SAMAR')?.name).toBe('SAN ISIDRO NORTHERN SAMAR');
  });

  it('renames legacy center records in place so RouteStop references keep the same IDs', () => {
    const legacy = [{ id: 'referenced-stop-id', active: true, name: 'Sogod - Town Center', cityMunicipality: 'Sogod', province: 'Southern Leyte', latitude: 10.3905, longitude: 124.9849 }];
    const action = buildImportPlan(legacy).find(item => item.canonical.name === 'SOGOD SOUTHERN LEYTE');
    expect(action).toMatchObject({ kind: 'updated', existing: { id: 'referenced-stop-id' }, data: { name: 'SOGOD SOUTHERN LEYTE' } });
  });

  it('plans no duplicate inserts when all canonical records already exist', () => {
    const plan = buildImportPlan(existing());
    expect(plan.filter(action => action.kind === 'inserted')).toHaveLength(0);
    expect(plan.filter(action => action.kind === 'skipped')).toHaveLength(143);
  });

  it('requires explicit confirmation for production writes but permits dry runs', () => {
    expect(() => assertImportAllowed('production', [])).toThrow(/confirm-production-import/);
    expect(() => assertImportAllowed('production', ['--dry-run'])).not.toThrow();
    expect(() => assertImportAllowed('production', ['--confirm-production-import'])).not.toThrow();
  });

  it('performs no write or transaction during a dry run', async () => {
    const db = { stop: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() }, $transaction: jest.fn() };
    const result = await importCanonicalStops(db, true);
    expect(result.actions.filter(action => action.kind === 'inserted')).toHaveLength(143);
    expect(db.stop.create).not.toHaveBeenCalled(); expect(db.stop.update).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
