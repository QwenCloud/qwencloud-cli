/**
 * Cache layer type definitions.
 * Provides interfaces for the two-tier (L1 memory + L2 file) caching strategy.
 */

/** File-based cache interface (generic for testability). */
export interface FileCache {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttl?: number): void;
  delete(key: string): void;
}

export type CacheKey = string;

export interface CachedFetcher {
  getOrFetch<T>(
    key: CacheKey,
    ttl: number,
    fetcher: () => Promise<T>,
    opts?: { skipFileCache?: boolean },
  ): Promise<T>;

  invalidate(key: CacheKey): void;
}
