import crypto from 'node:crypto';

const SEARCH_QUERY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedQuery {
  query: string;
  expiresAt: number;
}

const queryMap = new Map<string, CachedQuery>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, item] of queryMap.entries()) {
    if (item.expiresAt <= now) {
      queryMap.delete(key);
    }
  }
}

/**
 * Stores a search query in memory under a compact 8-character hex key (ASCII, 8 bytes).
 * TTL: 1 hour.
 */
export function storeSearchQuery(query: string): string {
  purgeExpired();
  const key = crypto.randomBytes(4).toString('hex'); // 8 hex characters
  queryMap.set(key, {
    query: query.trim(),
    expiresAt: Date.now() + SEARCH_QUERY_TTL_MS,
  });
  return key;
}

/**
 * Retrieves a search query by its key. Returns undefined if expired or missing.
 */
export function getSearchQuery(key: string): string | undefined {
  purgeExpired();
  const item = queryMap.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    queryMap.delete(key);
    return undefined;
  }
  return item.query;
}
