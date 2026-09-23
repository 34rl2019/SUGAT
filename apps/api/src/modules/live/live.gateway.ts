import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { AuthUser } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { LiveService } from './live.service';

const ADMIN_ROOM = 'admin:operations';
const tripRoom = (tripId: string) => `trip:${tripId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SubscriptionResult = { ok: true; subscribed: boolean; tripId?: string } | { ok: false; code: string; message: string };

@WebSocketGateway({ namespace: '/live' })
export class LiveGateway {
  @WebSocketServer() server!: Server;
  constructor(private jwt: JwtService, private db: PrismaService, private live: LiveService) {}
  private subscriptionWork = new WeakMap<Socket, Promise<unknown>>();

  @SubscribeMessage('trips.subscribe')
  subscribeOverview(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    // Serialize replacement requests so a slower old search cannot restore obsolete rooms.
    const previous = this.subscriptionWork.get(client) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.replaceOverview(client, body));
    this.subscriptionWork.set(client, next);
    return next;
  }

  private async replaceOverview(client: Socket, body: unknown) {
    const request = body as { fromStopId?: unknown; toStopId?: unknown; tripIds?: unknown } | null;
    if (!request || typeof request.fromStopId !== 'string' || !UUID.test(request.fromStopId) || typeof request.toStopId !== 'string' || !UUID.test(request.toStopId) || request.fromStopId === request.toStopId || (request.tripIds !== undefined && (!Array.isArray(request.tripIds) || request.tripIds.length > 500 || request.tripIds.some(id => typeof id !== 'string' || !UUID.test(id))))) {
      return { ok: false, code: 'INVALID_SEARCH', message: 'A valid origin, destination, and trip list are required.' };
    }
    const matches = await this.live.search(request.fromStopId, request.toStopId);
    const allowed = new Set(matches.map(trip => trip.tripId));
    // Trips may finish between HTTP search and subscription. Drop those IDs without
    // granting access to any unrelated or no-longer-matching trip.
    const tripIds = request.tripIds === undefined ? [...allowed] : [...new Set(request.tripIds as string[])].filter(id => allowed.has(id));
    const old = (client.data.overviewTripIds ?? []) as string[];
    for (const id of old) if (!tripIds.includes(id) && client.data.tripId !== id) await client.leave(tripRoom(id));
    for (const id of tripIds) await client.join(tripRoom(id));
    client.data.overviewTripIds = tripIds;
    return { ok: true, subscribed: true, tripIds };
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) { client.data.public = true; return; }
    try {
      const user = await this.jwt.verifyAsync<AuthUser>(token, { secret: process.env.JWT_ACCESS_SECRET });
      if (!user?.sub || !user.role) throw new Error('Malformed access token');
      client.data.user = user;
    } catch { client.disconnect(true); }
  }

  @SubscribeMessage('trip.subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<SubscriptionResult> {
    const tripId = typeof body === 'object' && body !== null ? (body as { tripId?: unknown }).tripId : undefined;
    if (typeof tripId !== 'string' || !UUID.test(tripId)) return { ok: false, code: 'INVALID_TRIP_ID', message: 'A valid trip ID is required.' };
    const trip = await this.db.trip.findUnique({ where: { id: tripId }, select: { status: true } });
    if (!trip || trip.status !== 'ACTIVE') return { ok: false, code: 'TRIP_UNAVAILABLE', message: 'This trip is not available for live tracking.' };
    const previous = client.data.tripId as string | undefined;
    if (previous === tripId) return { ok: true, subscribed: true, tripId };
    if (previous && !client.data.overviewTripIds?.includes(previous)) await client.leave(tripRoom(previous));
    await client.join(tripRoom(tripId));
    client.data.tripId = tripId;
    return { ok: true, subscribed: true, tripId };
  }

  @SubscribeMessage('trip.unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body?: unknown): Promise<SubscriptionResult> {
    const requested = typeof body === 'object' && body !== null ? (body as { tripId?: unknown }).tripId : undefined;
    if (requested !== undefined && (typeof requested !== 'string' || !UUID.test(requested))) return { ok: false, code: 'INVALID_TRIP_ID', message: 'A valid trip ID is required.' };
    const current = client.data.tripId as string | undefined;
    if (current && (!requested || requested === current)) { if (!client.data.overviewTripIds?.includes(current)) await client.leave(tripRoom(current)); delete client.data.tripId; }
    return { ok: true, subscribed: false, ...(typeof requested === 'string' ? { tripId: requested } : current ? { tripId: current } : {}) };
  }

  @SubscribeMessage('admin.subscribe')
  async subscribeAdmin(@ConnectedSocket() client: Socket): Promise<SubscriptionResult> {
    const identity = client.data.user as AuthUser | undefined;
    if (!identity || identity.role !== 'ADMIN' || !identity.sid) return { ok: false, code: 'ADMIN_UNAUTHORIZED', message: 'Admin authorization required.' };
    const account = await this.db.user.findUnique({ where: { id: identity.sub }, select: { role: true, accountStatus: true, sessions: { where: { id: identity.sid, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true }, take: 1 } } });
    if (!account || account.role !== 'ADMIN' || account.accountStatus !== 'ACTIVE' || account.sessions.length !== 1) {
      await client.leave(ADMIN_ROOM);
      return { ok: false, code: 'ADMIN_UNAUTHORIZED', message: 'Admin authorization required.' };
    }
    await client.join(ADMIN_ROOM);
    return { ok: true, subscribed: true };
  }

  publishLocation(tripId:string,payload:unknown){this.server.to(tripRoom(tripId)).emit('trip.location.updated',payload);this.server.to(ADMIN_ROOM).emit('trip.location.updated',payload);}
  publishOccupancy(tripId:string,payload:unknown){this.server.to(tripRoom(tripId)).emit('trip.occupancy.updated',payload);this.server.to(ADMIN_ROOM).emit('trip.occupancy.updated',payload);}
  publishStarted(tripId:string){this.server.to(ADMIN_ROOM).emit('trip.started',{tripId});}
  publishStop(tripId:string,type:string,payload:unknown){this.server.to(tripRoom(tripId)).emit(type==='STOP_ARRIVED'?'trip.stop.arrived':'trip.stop.approaching',payload);}
  publishEnded(tripId:string){const payload={tripId};const room=tripRoom(tripId);this.server.to(room).emit('trip.completed',payload);this.server.to(ADMIN_ROOM).emit('trip.completed',payload);this.server.in(room).socketsLeave(room);}
}
