import { locationFreshness } from './live-policy';
describe('location freshness',()=>{it('distinguishes fresh and unavailable GPS',()=>{expect(locationFreshness(new Date())).toBe('LIVE');expect(locationFreshness(new Date(Date.now()-700_000))).toBe('OFFLINE');});});
