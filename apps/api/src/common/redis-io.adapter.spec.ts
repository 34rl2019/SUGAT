const clients: MockRedis[] = [];

class MockRedis {
  static connectError: Error | null = null;
  handlers: Record<string, Array<(...args: any[]) => void>> = {};
  options: Record<string, unknown>;
  quit = jest.fn().mockResolvedValue('OK');

  constructor(_url: string, options: Record<string, unknown>) {
    this.options = options;
    clients.push(this);
  }
  duplicate() { return new MockRedis('', this.options); }
  connect() { return MockRedis.connectError ? Promise.reject(MockRedis.connectError) : Promise.resolve(); }
  on(event: string, handler: (...args: any[]) => void) { (this.handlers[event] ??= []).push(handler); return this; }
  emit(event: string, ...args: any[]) { for (const handler of this.handlers[event] ?? []) handler(...args); }
}

jest.mock('ioredis', () => ({ __esModule: true, default: MockRedis }));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn(() => 'redis-adapter') }));

import { RedisIoAdapter } from './redis-io.adapter';

describe('RedisIoAdapter runtime resilience', () => {
  const previousUrl = process.env.REDIS_URL;
  beforeEach(() => { clients.length = 0; MockRedis.connectError = null; process.env.REDIS_URL = 'redis://example.invalid:6379'; });
  afterAll(() => { process.env.REDIS_URL = previousUrl; });

  it('registers runtime handlers and keeps commands queued during a temporary outage', async () => {
    const adapter = new RedisIoAdapter({} as any);
    await adapter.connect();
    expect(clients).toHaveLength(2);
    for (const client of clients) {
      expect(client.options.maxRetriesPerRequest).toBeNull();
      expect(Object.keys(client.handlers)).toEqual(expect.arrayContaining(['error', 'close', 'reconnecting', 'ready', 'end']));
      expect(() => client.emit('error', new Error('connection lost'))).not.toThrow();
    }
  });

  it('waits for both clients before declaring runtime recovery', async () => {
    const adapter = new RedisIoAdapter({} as any);
    const log = jest.spyOn((adapter as any).logger, 'log');
    await adapter.connect();
    clients[0].emit('error', new Error('connection lost'));
    clients[0].emit('ready');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('recovered'));
    clients[1].emit('ready');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('recovered'));
  });

  it('contains an initial connection failure and closes both clients', async () => {
    MockRedis.connectError = new Error('connection refused');
    const adapter = new RedisIoAdapter({} as any);
    await expect(adapter.connect()).resolves.toBeUndefined();
    expect(clients).toHaveLength(2);
    expect(clients.every((client) => client.quit.mock.calls.length === 1)).toBe(true);
  });
});
