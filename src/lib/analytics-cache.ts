// In-memory analytics cache with configurable TTL
// Reduces heavy DB queries for categories, bestsellers, wilayas analytics

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number; // in milliseconds
}

class AnalyticsCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxSize = 200; // Maximum cache entries to prevent OOM
  
  // Default TTL: 5 minutes
  private defaultTTL = 300_000;

  /**
   * Get a cached value by key
   * Returns null if not found or expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set a value in cache with optional custom TTL
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // LRU eviction: remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    });
  }

  /**
   * Get or compute a cached value.
   * If the key exists and is not expired, returns cached value.
   * Otherwise, calls computeFn, caches the result, and returns it.
   */
  async getOrCompute<T>(key: string, computeFn: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await computeFn();
    this.set(key, data, ttl);
    return data;
  }

  /**
   * Invalidate a specific cache key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a prefix
   * Useful when an order/product is created/updated
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { entries: number; keys: string[] } {
    return {
      entries: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.cachedAt > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Singleton instance
export const analyticsCache = new AnalyticsCache();

// Auto-cleanup every 10 minutes
setInterval(() => {
  analyticsCache.cleanup();
}, 600_000);

/**
 * Generate a cache key for analytics queries.
 * Includes the type, storeId, and period for proper cache isolation.
 */
export function analyticsCacheKey(type: string, params: { storeId?: string | null; period?: string; [key: string]: unknown }): string {
  const parts = [`analytics:${type}`];
  if (params.storeId) parts.push(params.storeId);
  if (params.period) parts.push(params.period);
  
  // Add other params in sorted order for consistency
  const otherParams = Object.entries(params)
    .filter(([k]) => k !== 'storeId' && k !== 'period')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  parts.push(...otherParams);
  
  return parts.join(':');
}
