import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MemoryCache,
  getGlobalCache,
  resetGlobalCache,
  FileCache,
  getGlobalFileCache,
  resetGlobalFileCache,
  setFileCacheContextResolver,
  FILE_CACHE_SCHEMA_VERSION,
  CacheKeys,
} from '../../src/utils/cache.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
    renameSync: vi.fn(actual.renameSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

vi.mock('../../src/config/paths.js', () => ({
  getCacheFilePath: (fileName: string) => `/tmp/test-cache/${fileName}`,
}));

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MemoryCache(1000); // 1 second default TTL
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it('should return null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('should store and retrieve values', () => {
    cache.set('key1', { value: 42 });
    expect(cache.get('key1')).toEqual({ value: 42 });
  });

  it('should store and retrieve string values', () => {
    cache.set('str', 'hello');
    expect(cache.get('str')).toBe('hello');
  });

  it('should return null for expired entries', () => {
    cache.set('key1', 'value');
    vi.advanceTimersByTime(1001); // Exceed 1s TTL
    expect(cache.get('key1')).toBeNull();
  });

  it('should return value before TTL expires', () => {
    cache.set('key1', 'value');
    vi.advanceTimersByTime(999); // Just before TTL
    expect(cache.get('key1')).toBe('value');
  });

  it('should support custom TTL per entry', () => {
    cache.set('short', 'data', 500);
    cache.set('long', 'data', 5000);

    vi.advanceTimersByTime(600);
    expect(cache.get('short')).toBeNull();
    expect(cache.get('long')).toBe('data');
  });

  it('should overwrite existing entries', () => {
    cache.set('key', 'v1');
    cache.set('key', 'v2');
    expect(cache.get('key')).toBe('v2');
  });

  it('should delete entries', () => {
    cache.set('key', 'value');
    cache.delete('key');
    expect(cache.get('key')).toBeNull();
  });

  it('should clear all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('should report has() correctly', () => {
    cache.set('key', 'value');
    expect(cache.has('key')).toBe(true);
    expect(cache.has('missing')).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(cache.has('key')).toBe(false);
  });

  it('should return stats', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.keys).toContain('a');
    expect(stats.keys).toContain('b');
  });

  it('should auto-cleanup expired entries', () => {
    cache.set('expire-soon', 'data', 500);
    cache.set('stay', 'data', 120_000);

    // Advance past the cleanup interval (60s) and past the short TTL
    vi.advanceTimersByTime(61_000);

    // After cleanup, expired entry should be removed from store
    const stats = cache.getStats();
    expect(stats.keys).not.toContain('expire-soon');
    expect(stats.keys).toContain('stay');
  });

  it('should dispose and clear everything', () => {
    cache.set('key', 'value');
    cache.dispose();
    expect(cache.get('key')).toBeNull();
    expect(cache.getStats().size).toBe(0);
  });
});

describe('getGlobalCache / resetGlobalCache', () => {
  afterEach(() => {
    resetGlobalCache();
  });

  it('should return a singleton instance', () => {
    const c1 = getGlobalCache();
    const c2 = getGlobalCache();
    expect(c1).toBe(c2);
  });

  it('should return a new instance after reset', () => {
    const c1 = getGlobalCache();
    resetGlobalCache();
    const c2 = getGlobalCache();
    expect(c1).not.toBe(c2);
  });
});

describe('FileCache', () => {
  let fileCache: FileCache;
  let fsMock: {
    existsSync: ReturnType<typeof vi.fn>;
    readFileSync: ReturnType<typeof vi.fn>;
    writeFileSync: ReturnType<typeof vi.fn>;
    mkdirSync: ReturnType<typeof vi.fn>;
    renameSync: ReturnType<typeof vi.fn>;
    unlinkSync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    fileCache = new FileCache();
    const fs = await import('fs');
    fsMock = {
      existsSync: fs.existsSync as unknown as ReturnType<typeof vi.fn>,
      readFileSync: fs.readFileSync as unknown as ReturnType<typeof vi.fn>,
      writeFileSync: fs.writeFileSync as unknown as ReturnType<typeof vi.fn>,
      mkdirSync: fs.mkdirSync as unknown as ReturnType<typeof vi.fn>,
      renameSync: fs.renameSync as unknown as ReturnType<typeof vi.fn>,
      unlinkSync: fs.unlinkSync as unknown as ReturnType<typeof vi.fn>,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    setFileCacheContextResolver(null);
    resetGlobalFileCache();
  });

  describe('get', () => {
    it('should return null when context resolver is not set', () => {
      setFileCacheContextResolver(null);
      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });

    it('should return null when ttlMs is 0 (disabled)', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 0 }));
      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });

    it('should return null when file does not exist', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(false);
      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });

    it('should return null when file read throws', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });

    it('should return null and unlink when JSON is invalid', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('not valid json {{');
      fsMock.unlinkSync.mockImplementation(() => {});

      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
      expect(fsMock.unlinkSync).toHaveBeenCalled();
    });

    it('should return null for schema version mismatch', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify({
        schemaVersion: 999,
        key: CacheKeys.MODELS_RAW_LIST,
        endpoint: 'https://mock-api.test.qwencloud.com',
        expiresAt: Date.now() + 60000,
        data: [],
      }));
      fsMock.unlinkSync.mockImplementation(() => {});

      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });

    it('should return null for key mismatch', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify({
        schemaVersion: FILE_CACHE_SCHEMA_VERSION,
        key: 'wrong:key',
        endpoint: 'https://mock-api.test.qwencloud.com',
        expiresAt: Date.now() + 60000,
        data: [],
      }));
      fsMock.unlinkSync.mockImplementation(() => {});

      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });

    it('should return null for endpoint mismatch', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify({
        schemaVersion: FILE_CACHE_SCHEMA_VERSION,
        key: CacheKeys.MODELS_RAW_LIST,
        endpoint: 'https://other-endpoint.test.qwencloud.com',
        expiresAt: Date.now() + 60000,
        data: [],
      }));
      fsMock.unlinkSync.mockImplementation(() => {});

      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
      expect(fsMock.unlinkSync).toHaveBeenCalled();
    });

    it('should return null for expired entry', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify({
        schemaVersion: FILE_CACHE_SCHEMA_VERSION,
        key: CacheKeys.MODELS_RAW_LIST,
        endpoint: 'https://mock-api.test.qwencloud.com',
        expiresAt: Date.now() - 1000,
        data: [],
      }));
      fsMock.unlinkSync.mockImplementation(() => {});

      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
      expect(fsMock.unlinkSync).toHaveBeenCalled();
    });

    it('should return data for valid non-expired entry', () => {
      const testData = [{ id: 'model-1', name: 'Test Model' }];
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify({
        schemaVersion: FILE_CACHE_SCHEMA_VERSION,
        cliVersion: '1.0.0',
        key: CacheKeys.MODELS_RAW_LIST,
        endpoint: 'https://mock-api.test.qwencloud.com',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
        ttlMs: 60000,
        data: testData,
      }));

      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toEqual(testData);
    });

    it('should return null when context resolver throws', () => {
      setFileCacheContextResolver(() => {
        throw new Error('config not ready');
      });
      expect(fileCache.get(CacheKeys.MODELS_RAW_LIST)).toBeNull();
    });
  });

  describe('set', () => {
    it('should skip write when context resolver is not set', () => {
      setFileCacheContextResolver(null);
      fileCache.set(CacheKeys.MODELS_RAW_LIST, []);
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it('should skip write when ttlMs is 0', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 0 }));
      fileCache.set(CacheKeys.MODELS_RAW_LIST, []);
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it('should create directory if it does not exist', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(false);
      fsMock.mkdirSync.mockImplementation(() => undefined);
      fsMock.writeFileSync.mockImplementation(() => {});
      fsMock.renameSync.mockImplementation(() => {});

      fileCache.set(CacheKeys.MODELS_RAW_LIST, [{ id: 'test' }]);

      expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should write tmp file and rename atomically', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.writeFileSync.mockImplementation(() => {});
      fsMock.renameSync.mockImplementation(() => {});

      fileCache.set(CacheKeys.MODELS_RAW_LIST, ['data']);

      expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
      const writtenPath = fsMock.writeFileSync.mock.calls[0][0] as string;
      expect(writtenPath).toContain('.tmp.');
      expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
    });

    it('should swallow write errors gracefully', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.writeFileSync.mockImplementation(() => {
        throw new Error('ENOSPC');
      });
      fsMock.unlinkSync.mockImplementation(() => {});

      expect(() => fileCache.set(CacheKeys.MODELS_RAW_LIST, [])).not.toThrow();
    });

    it('should swallow mkdirSync errors gracefully', () => {
      setFileCacheContextResolver(() => ({ endpoint: 'https://mock-api.test.qwencloud.com', ttlMs: 60000 }));
      fsMock.existsSync.mockReturnValue(false);
      fsMock.mkdirSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      expect(() => fileCache.set(CacheKeys.MODELS_RAW_LIST, [])).not.toThrow();
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should unlink the cache file if it exists', () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.unlinkSync.mockImplementation(() => {});

      fileCache.delete(CacheKeys.MODELS_RAW_LIST);

      expect(fsMock.unlinkSync).toHaveBeenCalledWith('/tmp/test-cache/models-raw-list.json');
    });

    it('should not throw if file does not exist', () => {
      fsMock.existsSync.mockReturnValue(false);

      expect(() => fileCache.delete(CacheKeys.MODELS_RAW_LIST)).not.toThrow();
    });
  });
});

describe('getGlobalFileCache / resetGlobalFileCache', () => {
  afterEach(() => {
    resetGlobalFileCache();
  });

  it('should return a singleton instance', () => {
    const c1 = getGlobalFileCache();
    const c2 = getGlobalFileCache();
    expect(c1).toBe(c2);
  });

  it('should return a new instance after reset', () => {
    const c1 = getGlobalFileCache();
    resetGlobalFileCache();
    const c2 = getGlobalFileCache();
    expect(c1).not.toBe(c2);
  });
});
