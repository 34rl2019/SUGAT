import { LiveGateway } from './live.gateway';

const TRIP_A = '11111111-1111-4111-8111-111111111111';
const TRIP_B = '22222222-2222-4222-8222-222222222222';
const socket = (user?: unknown) => ({ data: { ...(user ? { user } : {}) }, handshake: { auth: {} }, join: jest.fn(), leave: jest.fn(), disconnect: jest.fn() } as any);

describe('LiveGateway subscriptions', () => {
  it('joins all requested matching trips, excludes unrelated trips, and restores rooms on reconnect',async()=>{
    const live:any={search:jest.fn().mockResolvedValue([{tripId:TRIP_A},{tripId:TRIP_B}])};
    const gateway=new LiveGateway({}as any,{}as any,live),client=socket();
    const unrelated='33333333-3333-4333-8333-333333333333';
    const request={fromStopId:TRIP_A,toStopId:TRIP_B,tripIds:[TRIP_A,TRIP_B,unrelated]};
    expect(await gateway.subscribeOverview(client,request)).toMatchObject({ok:true,tripIds:[TRIP_A,TRIP_B]});
    expect(client.join.mock.calls.map((call:any)=>call[0])).toEqual([`trip:${TRIP_A}`,`trip:${TRIP_B}`]);
    expect(client.join).not.toHaveBeenCalledWith('admin:operations');
    const next=socket();await gateway.subscribeOverview(next,request);expect(next.join).toHaveBeenCalledTimes(2);
    live.search.mockResolvedValue([{tripId:TRIP_B}]);await gateway.subscribeOverview(client,request);expect(client.leave).toHaveBeenCalledWith(`trip:${TRIP_A}`);
  });
  it('rejects malformed multi-trip requests before querying the public service',async()=>{const live:any={search:jest.fn()},gateway=new LiveGateway({}as any,{}as any,live);expect(await gateway.subscribeOverview(socket(),{tripIds:['invalid']})).toMatchObject({ok:false});expect(live.search).not.toHaveBeenCalled()});
  const setup = () => {
    const db = { trip: { findUnique: jest.fn() }, user: { findUnique: jest.fn() } };
    const jwt = { verifyAsync: jest.fn() };
    return { gateway: new LiveGateway(jwt as any, db as any, {search:jest.fn()} as any), db, jwt };
  };

  it('allows a legitimate anonymous ACTIVE trip and makes repeat subscription idempotent', async () => {
    const { gateway, db } = setup(), client = socket(); db.trip.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    expect(await gateway.subscribe(client, { tripId: TRIP_A })).toEqual({ ok: true, subscribed: true, tripId: TRIP_A });
    expect(await gateway.subscribe(client, { tripId: TRIP_A })).toEqual({ ok: true, subscribed: true, tripId: TRIP_A });
    expect(client.join).toHaveBeenCalledTimes(1); expect(client.leave).not.toHaveBeenCalled();
  });

  it.each([null, {}, { tripId: 'not-a-uuid' }])('rejects malformed subscription payload %p', async body => {
    const { gateway, db } = setup(); expect(await gateway.subscribe(socket(), body)).toMatchObject({ ok: false, code: 'INVALID_TRIP_ID' }); expect(db.trip.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, { status: 'READY' }, { status: 'COMPLETED' }, { status: 'CANCELLED' }])('rejects nonexistent or non-trackable trips', async trip => {
    const { gateway, db } = setup(); db.trip.findUnique.mockResolvedValue(trip); expect(await gateway.subscribe(socket(), { tripId: TRIP_A })).toMatchObject({ ok: false, code: 'TRIP_UNAVAILABLE' });
  });

  it('enforces one active trip room when switching', async () => {
    const { gateway, db } = setup(), client = socket(); db.trip.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    await gateway.subscribe(client, { tripId: TRIP_A }); await gateway.subscribe(client, { tripId: TRIP_B });
    expect(client.leave).toHaveBeenCalledWith(`trip:${TRIP_A}`); expect(client.join).toHaveBeenLastCalledWith(`trip:${TRIP_B}`); expect(client.data.tripId).toBe(TRIP_B);
  });

  it('unsubscribes idempotently and rejects malformed IDs', async () => {
    const { gateway } = setup(), client = socket(); client.data.tripId = TRIP_A;
    expect(await gateway.unsubscribe(client, { tripId: TRIP_A })).toEqual({ ok: true, subscribed: false, tripId: TRIP_A }); expect(client.leave).toHaveBeenCalledWith(`trip:${TRIP_A}`);
    expect(await gateway.unsubscribe(client, { tripId: TRIP_A })).toEqual({ ok: true, subscribed: false, tripId: TRIP_A });
    expect(await gateway.unsubscribe(client, { tripId: 'bad' })).toMatchObject({ ok: false, code: 'INVALID_TRIP_ID' });
  });

  it.each([
    [undefined, null],
    [{ sub: TRIP_A, role: 'DRIVER', sid: TRIP_B }, null],
    [{ sub: TRIP_A, role: 'ADMIN', sid: TRIP_B }, null],
    [{ sub: TRIP_A, role: 'ADMIN', sid: TRIP_B }, { role: 'ADMIN', accountStatus: 'DISABLED', sessions: [{ id: TRIP_B }] }],
    [{ sub: TRIP_A, role: 'ADMIN', sid: TRIP_B }, { role: 'DRIVER', accountStatus: 'ACTIVE', sessions: [{ id: TRIP_B }] }],
    [{ sub: TRIP_A, role: 'ADMIN', sid: TRIP_B }, { role: 'ADMIN', accountStatus: 'ACTIVE', sessions: [] }],
  ])('rejects unauthorized, non-admin, inactive, role-changed, or revoked admin sessions', async (identity, account) => {
    const { gateway, db } = setup(), client = socket(identity); db.user.findUnique.mockResolvedValue(account);
    expect(await gateway.subscribeAdmin(client)).toMatchObject({ ok: false, code: 'ADMIN_UNAUTHORIZED' }); expect(client.join).not.toHaveBeenCalled();
  });

  it('authorizes a current active admin session and permits reconnect resubscription', async () => {
    const { gateway, db } = setup(), identity = { sub: TRIP_A, role: 'ADMIN', sid: TRIP_B }, account = { role: 'ADMIN', accountStatus: 'ACTIVE', sessions: [{ id: TRIP_B }] };
    db.user.findUnique.mockResolvedValue(account); const first = socket(identity), reconnected = socket(identity);
    expect(await gateway.subscribeAdmin(first)).toEqual({ ok: true, subscribed: true }); expect(await gateway.subscribeAdmin(reconnected)).toEqual({ ok: true, subscribed: true });
    expect(first.join).toHaveBeenCalledWith('admin:operations'); expect(reconnected.join).toHaveBeenCalledWith('admin:operations');
  });
});

describe('LiveGateway room publishing', () => {
  const setup = () => { const emit = jest.fn(), socketsLeave = jest.fn(), to = jest.fn().mockReturnValue({ emit }), inRoom = jest.fn().mockReturnValue({ socketsLeave }), gateway = new LiveGateway({} as any, {} as any, {} as any); gateway.server = { to, in: inRoom } as any; return { gateway, to, emit, inRoom, socketsLeave }; };
  it('sends locations only to the selected trip and admin rooms', () => { const { gateway, to, emit } = setup(); gateway.publishLocation(TRIP_A, { latitude: 11 }); expect(to).toHaveBeenNthCalledWith(1, `trip:${TRIP_A}`); expect(to).toHaveBeenNthCalledWith(2, 'admin:operations'); expect(emit).toHaveBeenCalledTimes(2); });
  it('sends completion then evicts the completed trip room', () => { const { gateway, to, inRoom, socketsLeave } = setup(); gateway.publishEnded(TRIP_A); expect(to).toHaveBeenNthCalledWith(1, `trip:${TRIP_A}`); expect(to).toHaveBeenNthCalledWith(2, 'admin:operations'); expect(inRoom).toHaveBeenCalledWith(`trip:${TRIP_A}`); expect(socketsLeave).toHaveBeenCalled(); });
});
