jest.mock('redis');
import { createClient } from 'redis';
import { CacheService } from './cache.service';

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

function fakeRedisClient() {
  const store = new Map<string, string>();
  return {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
  };
}

describe('CacheService', () => {
  beforeEach(() => {
    mockCreateClient.mockReset();
  });

  it('returns undefined for a key that was never set', async () => {
    const client = fakeRedisClient();
    mockCreateClient.mockReturnValue(client as never);
    const cache = new CacheService();

    await expect(cache.get('missing')).resolves.toBeUndefined();
  });

  it('round-trips a JSON value through set/get', async () => {
    const client = fakeRedisClient();
    mockCreateClient.mockReturnValue(client as never);
    const cache = new CacheService();

    await cache.set('key', { dishes: ['борщ'] }, 900);

    await expect(cache.get('key')).resolves.toEqual({ dishes: ['борщ'] });
    expect(client.set).toHaveBeenCalledWith(
      'key',
      JSON.stringify({ dishes: ['борщ'] }),
      { EX: 900 },
    );
  });

  it('connects the underlying client only once across repeated calls', async () => {
    const client = fakeRedisClient();
    mockCreateClient.mockReturnValue(client as never);
    const cache = new CacheService();

    await cache.get('a');
    await cache.set('b', 1, 60);
    await cache.get('c');

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('get() resolves to undefined (not a throw) when Redis is unreachable', async () => {
    const client = fakeRedisClient();
    client.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    mockCreateClient.mockReturnValue(client as never);
    const cache = new CacheService();

    await expect(cache.get('key')).resolves.toBeUndefined();
  });

  it('set() does not throw when Redis is unreachable', async () => {
    const client = fakeRedisClient();
    client.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    mockCreateClient.mockReturnValue(client as never);
    const cache = new CacheService();

    await expect(cache.set('key', 'value', 60)).resolves.toBeUndefined();
  });
});
