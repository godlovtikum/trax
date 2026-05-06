/**
 * Persistent write outbox for offline mutations.
 *
 * When a POST/PATCH/DELETE fails because the device has no internet,
 * the API client enqueues the request here. As soon as connectivity
 * returns the queue is drained in FIFO order and the app is told to
 * refetch its data.
 *
 * Each entry carries a stable `idempotencyKey` that is replayed as the
 * `Idempotency-Key` header. This means the server can safely dedupe
 * even when we don't know whether a previous attempt actually landed
 * (e.g. timeout after the request was committed but before the response
 * was received).
 *
 * Failed entries that are not pure network errors get retried with
 * exponential backoff up to `MAX_ATTEMPTS` times. Beyond that they are
 * moved to a separate "dead-letter" list for later inspection rather
 * than blocking the head of the queue.
 *
 * The queue and dead-letter list are stored in AsyncStorage so they
 * survive full app restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_STORAGE_KEY = 'trax.write_queue.v2';
const DEAD_LETTER_STORAGE_KEY = 'trax.write_queue.dead.v1';
const MAX_ATTEMPTS = 5;

export interface QueuedMutation {
  id: string;
  idempotencyKey: string;
  httpMethod: 'POST' | 'PATCH' | 'DELETE';
  requestPath: string;
  requestBody: unknown;
  enqueuedAt: number;
  attemptCount: number;
  /** Earliest wall-clock time (ms) the entry may be retried. */
  retryNotBefore: number;
}

export interface DeadLetterEntry extends QueuedMutation {
  failedAt: number;
  lastErrorName: string;
  lastErrorMessage: string;
}

let inMemoryQueue: QueuedMutation[] = [];
let inMemoryDeadLetter: DeadLetterEntry[] = [];
let queueHasBeenLoaded = false;
const queueChangeListeners = new Set<() => void>();

async function persistQueueToStorage(): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [QUEUE_STORAGE_KEY, JSON.stringify(inMemoryQueue)],
      [DEAD_LETTER_STORAGE_KEY, JSON.stringify(inMemoryDeadLetter)],
    ]);
  } catch (persistError) {
    console.warn('[queue] failed to persist write queue:', persistError);
  }
}

function notifyQueueChangeListeners(): void {
  for (const listener of queueChangeListeners) listener();
}

export async function loadQueueFromStorage(): Promise<void> {
  if (queueHasBeenLoaded) return;
  try {
    const pairs = await AsyncStorage.multiGet([
      QUEUE_STORAGE_KEY,
      DEAD_LETTER_STORAGE_KEY,
    ]);
    const rawQueue = pairs[0][1];
    const rawDead = pairs[1][1];
    inMemoryQueue = rawQueue ? (JSON.parse(rawQueue) as QueuedMutation[]) : [];
    inMemoryDeadLetter = rawDead
      ? (JSON.parse(rawDead) as DeadLetterEntry[])
      : [];
  } catch {
    inMemoryQueue = [];
    inMemoryDeadLetter = [];
  }
  queueHasBeenLoaded = true;
  notifyQueueChangeListeners();
}

export function getQueueSize(): number {
  return inMemoryQueue.length;
}

export function getDeadLetterSize(): number {
  return inMemoryDeadLetter.length;
}

export function getDeadLetterEntries(): readonly DeadLetterEntry[] {
  return inMemoryDeadLetter;
}

export function subscribeToQueueChanges(callback: () => void): () => void {
  queueChangeListeners.add(callback);
  return () => {
    queueChangeListeners.delete(callback);
  };
}

export async function enqueueMutation(
  mutation: Omit<
    QueuedMutation,
    'id' | 'enqueuedAt' | 'attemptCount' | 'retryNotBefore'
  >,
): Promise<QueuedMutation> {
  await loadQueueFromStorage();
  const newEntry: QueuedMutation = {
    ...mutation,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    enqueuedAt: Date.now(),
    attemptCount: 0,
    retryNotBefore: 0,
  };
  inMemoryQueue.push(newEntry);
  await persistQueueToStorage();
  notifyQueueChangeListeners();
  return newEntry;
}

export async function clearQueue(): Promise<void> {
  inMemoryQueue = [];
  inMemoryDeadLetter = [];
  await persistQueueToStorage();
  notifyQueueChangeListeners();
}

/**
 * Drain the queue using the supplied executor. Each entry is attempted
 * once per drain pass; on success it's removed. On a network failure
 * (executor throws a `NetworkError`), draining stops so we don't burn
 * through the queue while still offline. On any other rejection, the
 * entry is retried with exponential backoff up to `MAX_ATTEMPTS`, after
 * which it's moved to the dead-letter list.
 */
export async function drainQueue(
  executor: (mutation: QueuedMutation) => Promise<void>,
): Promise<{flushed: number; remaining: number; deadLettered: number}> {
  await loadQueueFromStorage();

  let flushedCount = 0;
  let deadLetteredCount = 0;
  const now = Date.now();

  // We do at most one pass per call. Skip entries whose backoff hasn't
  // elapsed; the next reconnect or scheduled drain will pick them up.
  let cursor = 0;
  while (cursor < inMemoryQueue.length) {
    const entry = inMemoryQueue[cursor];
    if (entry.retryNotBefore > now) {
      cursor += 1;
      continue;
    }
    entry.attemptCount += 1;

    try {
      await executor(entry);
      inMemoryQueue.splice(cursor, 1);
      flushedCount += 1;
      await persistQueueToStorage();
      notifyQueueChangeListeners();
    } catch (executorError: unknown) {
      const errorName =
        executorError && typeof executorError === 'object' && 'name' in executorError
          ? String((executorError as {name: unknown}).name)
          : '';
      const errorMessage =
        executorError && typeof executorError === 'object' && 'message' in executorError
          ? String((executorError as {message: unknown}).message)
          : '';

      if (errorName === 'NetworkError') {
        // Still offline — leave the queue intact and stop processing.
        return {
          flushed: flushedCount,
          remaining: inMemoryQueue.length,
          deadLettered: deadLetteredCount,
        };
      }

      if (entry.attemptCount >= MAX_ATTEMPTS) {
        const dead: DeadLetterEntry = {
          ...entry,
          failedAt: Date.now(),
          lastErrorName: errorName || 'Error',
          lastErrorMessage: errorMessage,
        };
        inMemoryDeadLetter.push(dead);
        inMemoryQueue.splice(cursor, 1);
        deadLetteredCount += 1;
        console.error(
          `[queue] dead-lettering ${entry.httpMethod} ${entry.requestPath} after ${entry.attemptCount} attempts:`,
          executorError,
        );
        await persistQueueToStorage();
        notifyQueueChangeListeners();
        continue;
      }

      // Schedule a backoff and move on so a poison pill doesn't block
      // the rest of the queue.
      const backoffMs = Math.min(
        60_000,
        500 * Math.pow(2, entry.attemptCount - 1),
      );
      entry.retryNotBefore = Date.now() + backoffMs;
      console.warn(
        `[queue] retrying ${entry.httpMethod} ${entry.requestPath} in ${backoffMs}ms (attempt ${entry.attemptCount}/${MAX_ATTEMPTS})`,
      );
      await persistQueueToStorage();
      notifyQueueChangeListeners();
      cursor += 1;
    }
  }

  return {
    flushed: flushedCount,
    remaining: inMemoryQueue.length,
    deadLettered: deadLetteredCount,
  };
}
