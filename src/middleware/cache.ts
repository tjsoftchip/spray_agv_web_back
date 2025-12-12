import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  data: any;
  timestamp: number;
}

class SimpleCache {
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTTL: number = 60000;

  set(key: string, data: any, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now() + (ttl || this.defaultTTL),
    });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.timestamp) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  clear(pattern?: string): void {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  clearAll(): void {
    this.cache.clear();
  }
}

export const cache = new SimpleCache();

export const cacheMiddleware = (ttl?: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.originalUrl}`;
    const cachedData = cache.get(key);

    if (cachedData) {
      return res.json(cachedData);
    }

    const originalJson = res.json.bind(res);
    res.json = function (data: any) {
      cache.set(key, data, ttl);
      return originalJson(data);
    };

    next();
  };
};

export const clearCacheMiddleware = (pattern: string) => {
  return (_req: Request, _res: Response, next: NextFunction) => {
    cache.clear(pattern);
    next();
  };
};
