/**
 * Read-through response cache.
 *
 * Every successful GET response is written here. When the device is
 * offline (or the network call fails), the API client serves the last
 * cached value so the app keeps working.
 *
 * The cache key is the canonicalised URL — query parameters are sorted
 * so `?a=1&b=2` and `?b=2&a=1` resolve to the same entry.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY_PREFIX = 'trax.cache.v1.';

export function buildCacheKey(
  httpMethod: string,
  requestPath: string,
  queryParameters?: Record<string, unknown>,
): string {
  const sortedQueryString = queryParameters
    ? Object.entries(queryParameters)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
        )
        .join('&')
    : '';
  const querySuffix = sortedQueryString ? `?${sortedQueryString}` : '';
  return `${CACHE_KEY_PREFIX}${httpMethod} ${requestPath}${querySuffix}`;
}

interface CachedEntry<T> {
  storedAt: number;
  payload: T;
}

export async function readCachedResponse<T>(cacheKey: string): Promise<T | null> {
  try {
    const rawValue = await AsyncStorage.getItem(cacheKey);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as CachedEntry<T>;
    return parsed.payload;
  } catch {
    return null;
  }
}

export async function writeCachedResponse<T>(
  cacheKey: string,
  payload: T,
): Promise<void> {
  try {
    const entry: CachedEntry<T> = {storedAt: Date.now(), payload};
    await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (writeError) {
    console.warn('[cache] failed to persist response:', writeError);
  }
}

export async function clearCachedResponses(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
    if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
  } catch (clearError) {
    console.warn('[cache] failed to clear:', clearError);
  }
}
