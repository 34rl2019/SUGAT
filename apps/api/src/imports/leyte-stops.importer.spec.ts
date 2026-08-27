import { leyteCanonicalStops } from './leyte-stops.data';
import { assertImportAllowed, buildImportPlan, importCanonicalStops, validateDataset } from './leyte-stops.importer';

const existing = () => leyteCanonicalStops.map((stop, index) => ({ ...stop, id: `stop-${index}`, active: true }));

describe('Leyte canonical stop importer', () => {
  it('contains exactly the required valid 62-stop dataset', () => {
    expect(leyteCanonicalStops).toHaveLength(62);
    expect(leyteCanonicalStops.filter(stop => stop.province === 'Southern Leyte')).toHaveLength(19);
    expect(leyteCanonicalStops.filter(stop => stop.province === 'Leyte')).toHaveLength(42);
    expect(leyteCanonicalStops.filter(stop => stop.province === 'Tacloban City')).toHaveLength(1);
    expect(validateDataset()).toBe(true);
  });

  it('rejects malformed and regionally impossible coordinates before import', () => {
    const invalid = leyteCanonicalStops.map(stop => ({ ...stop })); invalid[0].latitude = 91;
    expect(() => validateDataset(invalid)).toThrow(/invalid latitude/);
    invalid[0].latitude = 8;
    expect(() => validateDataset(invalid)).toThrow(/outside the Leyte/);
  });

  it('plans no duplicate inserts when all canonical records already exist', () => {
    const plan = buildImportPlan(existing());
    expect(plan.filter(action => action.kind === 'inserted')).toHaveLength(0);
    expect(plan.filter(action => action.kind === 'skipped')).toHaveLength(62);
  });

  it('requires explicit confirmation for a production write but permits dry runs', () => {
    expect(() => assertImportAllowed('production', [])).toThrow(/confirm-production-import/);
    expect(() => assertImportAllowed('production', ['--dry-run'])).not.toThrow();
    expect(() => assertImportAllowed('production', ['--confirm-production-import'])).not.toThrow();
  });

  it('performs no write or transaction during a dry run', async () => {
    const db = { stop: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() }, $transaction: jest.fn() };
    const result = await importCanonicalStops(db, true);
    expect(result.actions.filter(action => action.kind === 'inserted')).toHaveLength(62);
    expect(db.stop.create).not.toHaveBeenCalled(); expect(db.stop.update).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
