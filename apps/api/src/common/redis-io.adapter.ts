import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';
import { allowedOrigins } from './environment';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];
  private degraded = false;
  private readonly readyClients = new Set<string>();

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect() {
    const url = process.env.REDIS_URL;
    if (!url) return;
    const options = {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    };
    const pub = new Redis(url, options);
    const sub = pub.duplicate();
    this.clients = [pub, sub];
    this.observeClient(pub, 'publisher');
    this.observeClient(sub, 'subscriber');
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      this.adapterConstructor = createAdapter(pub, sub);
      this.degraded = false;
      this.logger.log('Socket.IO Redis adapter connected');
    } catch (error) {
      this.logUnavailable('initial connection', error);
      await Promise.allSettled(this.clients.map((client) => client.quit()));
      this.clients = [];
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOrigins(), credentials: true },
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close() {
    await Promise.allSettled(this.clients.map((client) => client.quit()));
    this.clients = [];
  }

  private observeClient(client: Redis, role: string) {
    const unavailable = (context: string, error?: unknown) => {
      this.readyClients.delete(role);
      this.logUnavailable(context, error);
    };
    client.on('error', (error) => unavailable(`${role} error`, error));
    client.on('close', () => unavailable(`${role} connection closed`));
    client.on('reconnecting', () => unavailable(`${role} reconnecting`));
    client.on('end', () => unavailable(`${role} connection ended`));
    client.on('ready', () => {
      this.readyClients.add(role);
      if (!this.degraded || this.readyClients.size !== this.clients.length) return;
      this.degraded = false;
      this.logger.log('Redis adapter recovered. Cross-instance realtime delivery restored.');
    });
  }

  private logUnavailable(context: string, error?: unknown) {
    if (this.degraded) return;
    this.degraded = true;
    const detail = error instanceof Error && error.name ? ` ${error.name}.` : '';
    this.logger.error(
      `Redis adapter unavailable (${context}). Cross-instance realtime delivery temporarily degraded; API remains operational.${detail}`,
    );
  }
}
