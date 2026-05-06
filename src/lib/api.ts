/**
 * API client.
 *
 * Speaks REST against the Netlify edge (which translates to Supabase
 * Edge Functions). Sessions use opaque server-issued tokens — there is
 * no JWT to decode on the client.
 *
 * Behaviours layered on top of the bare fetch:
 *
 *   1. Friendly error surfacing.  Every server response uses the
 *      envelope `{ success, data, error: { code, message } }`. On
 *      failure we throw an `ApiError` carrying the user-facing
 *      `message` ready to drop into a UI toast.
 *
 *   2. Reactive token refresh.  When a request comes back with HTTP 401
 *      or `error.code === 'auth.session_expired'`, we attempt a single
 *      `/api/auth/refresh` (single-flight across concurrent calls) and
 *      retry the original request once. The session is only cleared if
 *      the refresh itself fails.
 *
 *   3. Read-through cache.  Successful GETs are persisted to
 *      AsyncStorage so the screen content keeps working when the
 *      device is offline. On a network failure during a GET we
 *      transparently return the last cached response.
 *
 *   4. Write outbox.  POST/PATCH/DELETE that fail because the device
 *      is offline are pushed onto a persistent queue with a stable
 *      idempotency key. The queue auto-drains when connectivity
 *      returns, sending `Idempotency-Key` so the server can dedupe.
 */

import {Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {buildCacheKey, readCachedResponse, writeCachedResponse} from './cache';
import {
  enqueueMutation,
  loadQueueFromStorage,
  drainQueue,
  type QueuedMutation,
} from './queue';
import {
  isOnline,
  startNetworkStatusMonitoring,
  subscribeToNetworkStatus,
} from './network';

// ─── Configuration ─────────────────────────────────────────────────────────

const API_BASE_URL = 'https://trax-finance.netlify.app';

export const isApiConfigured = Boolean(API_BASE_URL);

const KEYCHAIN_SERVICE_NAME = 'trax';
const KEYCHAIN_USER_KEY = 'session';
// Refresh proactively when the access token has < 24h left.
const TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ─── User-facing error type ────────────────────────────────────────────────

export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly isOfflineError: boolean;

  constructor(
    code: string,
    userMessage: string,
    httpStatus: number,
    isOfflineError = false,
  ) {
    super(userMessage);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.isOfflineError = isOfflineError;
  }
}

class NetworkError extends Error {
  constructor() {
    super(
      "Couldn't reach the server. Please check your internet connection and retry.",
    );
    this.name = 'NetworkError';
  }
}

// ─── Session storage ───────────────────────────────────────────────────────

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {id: string; email: string; full_name?: string | null};
}

let inMemorySession: AuthSession | null = null;
const sessionChangeListeners = new Set<(session: AuthSession | null) => void>();

function emitSessionChange(): void {
  for (const listener of sessionChangeListeners) listener(inMemorySession);
}

export function onAuthChange(
  callback: (session: AuthSession | null) => void,
): () => void {
  sessionChangeListeners.add(callback);
  return () => {
    sessionChangeListeners.delete(callback);
  };
}

async function readSessionFromSecureStorage(): Promise<AuthSession | null> {
  if (Platform.OS === 'web') {
    try {
      const rawValue = globalThis.localStorage?.getItem('trax.session');
      return rawValue ? (JSON.parse(rawValue) as AuthSession) : null;
    } catch {
      return null;
    }
  }
  try {
    const credentials = await Keychain.getGenericPassword({
      service: KEYCHAIN_SERVICE_NAME,
    });
    if (!credentials) return null;
    return JSON.parse(credentials.password) as AuthSession;
  } catch {
    return null;
  }
}

async function writeSessionToSecureStorage(session: AuthSession): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem('trax.session', JSON.stringify(session));
    } catch {
      // best-effort
    }
    return;
  }
  await Keychain.setGenericPassword(KEYCHAIN_USER_KEY, JSON.stringify(session), {
    service: KEYCHAIN_SERVICE_NAME,
  });
}

async function deleteSessionFromSecureStorage(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem('trax.session');
    } catch {
      // best-effort
    }
    return;
  }
  await Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE_NAME});
}

export async function loadStoredSession(): Promise<AuthSession | null> {
  inMemorySession = await readSessionFromSecureStorage();
  return inMemorySession;
}

export async function setSession(session: AuthSession | null): Promise<void> {
  inMemorySession = session;
  if (session) await writeSessionToSecureStorage(session);
  else await deleteSessionFromSecureStorage();
  emitSessionChange();
}

export async function clearSession(): Promise<void> {
  await setSession(null);
}

export function getSession(): AuthSession | null {
  return inMemorySession;
}

// ─── Token refresh ─────────────────────────────────────────────────────────

let refreshPromiseInFlight: Promise<boolean> | null = null;

/**
 * Performs a single-flight refresh against `/api/auth/refresh`.
 * Resolves to `true` if the session was successfully rotated, `false`
 * otherwise. Multiple concurrent callers share one network call.
 */
function performTokenRefresh(): Promise<boolean> {
  if (refreshPromiseInFlight) return refreshPromiseInFlight;

  refreshPromiseInFlight = (async () => {
    if (!inMemorySession?.refresh_token) return false;
    try {
      const refreshed = await rawRequest<AuthSession>('POST', '/api/auth/refresh', {
        body: {refresh_token: inMemorySession.refresh_token},
        sendAuth: true,
        // Don't recurse: a 401 from the refresh endpoint itself means the
        // refresh token is dead.
        skipAuthRetry: true,
      });
      await setSession(refreshed);
      return true;
    } catch (refreshError) {
      // Only kill the session for an explicit 401 from refresh. Network
      // failures (no internet, server down) should leave the session
      // intact so the next call can try again.
      if (refreshError instanceof ApiError && refreshError.httpStatus === 401) {
        await clearSession();
      }
      return false;
    } finally {
      refreshPromiseInFlight = null;
    }
  })();

  return refreshPromiseInFlight;
}

async function refreshSessionIfApproachingExpiry(): Promise<void> {
  if (!inMemorySession) return;
  if (Date.now() < inMemorySession.expires_at - TOKEN_REFRESH_THRESHOLD_MS) return;
  if (!isOnline()) return; // can't refresh while offline; live with stale token
  await performTokenRefresh();
}

// ─── Public fetch wrapper ──────────────────────────────────────────────────

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Set to false for endpoints that don't require a session (login, signup). */
  auth?: boolean;
  /**
   * When false, the offline cache + write queue are bypassed. Used for
   * auth endpoints and refresh, where caching or queueing would be
   * misleading.
   */
  offlineable?: boolean;
  /**
   * Stable idempotency key sent as the `Idempotency-Key` header. Allows
   * the server to dedupe retried writes (e.g. from the offline outbox).
   */
  idempotencyKey?: string;
}

export async function apiFetch<T = unknown>(
  requestPath: string,
  options: ApiOptions = {},
): Promise<T> {
  if (!isApiConfigured) {
    throw new ApiError(
      'system.unknown_error',
      'The app is not fully configured. Please reinstall and try again.',
      500,
    );
  }

  const {
    method = 'GET',
    body,
    query,
    auth = true,
    offlineable = true,
    idempotencyKey,
  } = options;

  if (auth) await refreshSessionIfApproachingExpiry();

  // GETs use the read-through cache when offline. Mutations use the
  // write queue when offline. Anything else goes straight to the wire.
  if (offlineable && method === 'GET') {
    return getWithReadThroughCache<T>(requestPath, query, auth);
  }

  if (offlineable && method !== 'GET') {
    return mutateWithWriteQueue<T>(method, requestPath, body, query, auth, idempotencyKey);
  }

  return rawRequest<T>(method, requestPath, {body, query, sendAuth: auth, idempotencyKey});
}

async function getWithReadThroughCache<T>(
  requestPath: string,
  query: Record<string, string | number | undefined> | undefined,
  sendAuth: boolean,
): Promise<T> {
  const cacheKey = buildCacheKey('GET', requestPath, query);

  try {
    const freshResponse = await rawRequest<T>('GET', requestPath, {
      query,
      sendAuth,
    });
    await writeCachedResponse(cacheKey, freshResponse);
    return freshResponse;
  } catch (requestError) {
    if (requestError instanceof NetworkError) {
      const cachedResponse = await readCachedResponse<T>(cacheKey);
      if (cachedResponse !== null) return cachedResponse;
    }
    throw requestError;
  }
}

async function mutateWithWriteQueue<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  requestPath: string,
  body: unknown,
  query: Record<string, string | number | undefined> | undefined,
  sendAuth: boolean,
  idempotencyKey: string | undefined,
): Promise<T> {
  const effectiveKey = idempotencyKey ?? generateIdempotencyKey();
  try {
    return await rawRequest<T>(method, requestPath, {
      body,
      query,
      sendAuth,
      idempotencyKey: effectiveKey,
    });
  } catch (requestError) {
    if (requestError instanceof NetworkError) {
      await enqueueMutation({
        httpMethod: method,
        requestPath: appendQueryString(requestPath, query),
        requestBody: body ?? null,
        idempotencyKey: effectiveKey,
      });
      // Optimistic success — the queue will replay this once we're back
      // online. The caller doesn't get the server-issued payload, so
      // we return an empty object cast to T.
      return {} as T;
    }
    throw requestError;
  }
}

// ─── Low-level request ─────────────────────────────────────────────────────

interface RawRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  sendAuth: boolean;
  idempotencyKey?: string;
  /**
   * Internal: when `true`, a 401/`auth.session_expired` will NOT trigger
   * an automatic refresh + retry. Set on the refresh request itself and
   * on the second attempt of any retried call.
   */
  skipAuthRetry?: boolean;
}

async function rawRequest<T>(
  method: string,
  requestPath: string,
  options: RawRequestOptions,
): Promise<T> {
  const fullUrl = `${API_BASE_URL}${appendQueryString(requestPath, options.query)}`;
  const requestHeaders: Record<string, string> = {'Content-Type': 'application/json'};
  if (options.sendAuth && inMemorySession) {
    requestHeaders.Authorization = `Bearer ${inMemorySession.access_token}`;
  }
  if (options.idempotencyKey) {
    requestHeaders['Idempotency-Key'] = options.idempotencyKey;
  }

  let httpResponse: Response;
  try {
    httpResponse = await fetch(fullUrl, {
      method,
      headers: requestHeaders,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }

  const responseText = await httpResponse.text();
  let parsedEnvelope:
    | {
        success: boolean;
        data: unknown;
        error: {code: string; message: string} | null;
      }
    | null = null;
  if (responseText) {
    try {
      parsedEnvelope = JSON.parse(responseText);
    } catch {
      // Non-JSON response from infrastructure (rare). Treat as generic.
      parsedEnvelope = null;
    }
  }

  const isFailure =
    !httpResponse.ok || (parsedEnvelope && parsedEnvelope.success === false);

  if (isFailure) {
    const errorCode = parsedEnvelope?.error?.code ?? 'system.unknown_error';
    const userMessage =
      parsedEnvelope?.error?.message ??
      'Something went wrong on our end. Please try again in a moment.';
    const isAuthFailure =
      errorCode === 'auth.session_expired' || httpResponse.status === 401;

    // Reactive refresh: try once, then retry the original call.
    if (
      isAuthFailure &&
      options.sendAuth &&
      !options.skipAuthRetry &&
      inMemorySession?.refresh_token
    ) {
      const didRefresh = await performTokenRefresh();
      if (didRefresh) {
        return rawRequest<T>(method, requestPath, {
          ...options,
          skipAuthRetry: true,
        });
      }
      // Refresh failed → session is already cleared in performTokenRefresh.
    } else if (isAuthFailure && options.sendAuth && options.skipAuthRetry) {
      // Second 401 in a row, or the failure was on the refresh endpoint
      // itself. The session is unrecoverable.
      await clearSession();
    }

    throw new ApiError(errorCode, userMessage, httpResponse.status);
  }

  return (parsedEnvelope?.data ?? null) as T;
}

function appendQueryString(
  requestPath: string,
  query: Record<string, string | number | undefined> | undefined,
): string {
  if (!query) return requestPath;
  const queryString = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');
  return queryString ? `${requestPath}?${queryString}` : requestPath;
}

// ─── Idempotency key generator ─────────────────────────────────────────────

/**
 * Generates a UUID-v4-shaped identifier without importing a crypto polyfill.
 * Math.random is sufficient for client-side dedupe keys (server still
 * scopes by user_id + key).
 */
function generateIdempotencyKey(): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const s = Array.from(bytes, hex).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ─── Sync (queue drain on reconnect) ───────────────────────────────────────

const syncCompletionListeners = new Set<() => void>();

export function subscribeToSyncCompletion(callback: () => void): () => void {
  syncCompletionListeners.add(callback);
  return () => {
    syncCompletionListeners.delete(callback);
  };
}

let syncDrainInFlight = false;

async function replayQueuedMutationsAgainstServer(): Promise<void> {
  if (syncDrainInFlight) return;
  if (!isOnline()) return;
  syncDrainInFlight = true;
  try {
    const drainResult = await drainQueue(async (mutation: QueuedMutation) => {
      await rawRequest(mutation.httpMethod, mutation.requestPath, {
        body: mutation.requestBody,
        sendAuth: true,
        idempotencyKey: mutation.idempotencyKey,
      });
    });
    if (drainResult.flushed > 0) {
      for (const listener of syncCompletionListeners) listener();
    }
  } finally {
    syncDrainInFlight = false;
  }
}

/**
 * Wire up automatic queue draining whenever connectivity returns. Call
 * this once during app startup (App.tsx).
 */
export function initializeOfflineSync(): void {
  startNetworkStatusMonitoring();
  loadQueueFromStorage().then(() => {
    if (isOnline()) replayQueuedMutationsAgainstServer();
  });
  subscribeToNetworkStatus(connected => {
    if (connected) replayQueuedMutationsAgainstServer();
  });
}
