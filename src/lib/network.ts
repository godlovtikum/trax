/**
 * Network status — thin wrapper around @react-native-community/netinfo.
 *
 * Exposes a tiny, synchronous-feeling API to the rest of the app:
 *   • `isOnline()`                   — last-known connectivity (cached, sync)
 *   • `getNetworkStatus()`           — `'online' | 'offline' | 'unknown'`
 *   • `subscribeToNetworkStatus(cb)` — invoked when status flips
 *
 * Two pragmatic design choices:
 *
 *   1. `isInternetReachable === null` is a real value NetInfo emits while
 *      it's still probing. We treat it as "unknown" but keep `isOnline()`
 *      returning `true` so the UI doesn't flash an offline banner during
 *      the first second after launch.
 *
 *   2. Brief connectivity flaps (e.g. handing off between Wi-Fi and
 *      cellular) are debounced over a short window so a 200ms drop
 *      doesn't trigger redraws and queue replays.
 *
 * The wrapper guarantees we never crash on web/dev shells where NetInfo
 * isn't available — we fall back to "assume online" so the UI keeps
 * working in the simulator.
 */

import NetInfo, {NetInfoState} from '@react-native-community/netinfo';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

const FLAP_DEBOUNCE_MS = 750;

let lastKnownIsConnected = true;
let lastKnownStatus: NetworkStatus = 'unknown';
const networkListeners = new Set<(isConnected: boolean) => void>();
const statusListeners = new Set<(status: NetworkStatus) => void>();

let pendingApply: {status: NetworkStatus; isConnected: boolean} | null = null;
let pendingApplyTimer: ReturnType<typeof setTimeout> | null = null;

function applyNetworkState(state: NetInfoState): void {
  let computedStatus: NetworkStatus;
  if (state.isConnected === false) {
    computedStatus = 'offline';
  } else if (state.isInternetReachable === false) {
    computedStatus = 'offline';
  } else if (state.isInternetReachable === null) {
    // NetInfo hasn't probed yet. Treat as unknown but keep callers happy.
    computedStatus = 'unknown';
  } else {
    computedStatus = 'online';
  }
  // For boolean callers, both 'online' and 'unknown' count as connected.
  const computedIsConnected = computedStatus !== 'offline';

  // Coalesce rapid flaps. If the new state matches what we already have,
  // cancel any pending apply and bail.
  if (
    computedStatus === lastKnownStatus &&
    computedIsConnected === lastKnownIsConnected
  ) {
    if (pendingApplyTimer) {
      clearTimeout(pendingApplyTimer);
      pendingApplyTimer = null;
      pendingApply = null;
    }
    return;
  }

  pendingApply = {status: computedStatus, isConnected: computedIsConnected};

  if (pendingApplyTimer) clearTimeout(pendingApplyTimer);
  pendingApplyTimer = setTimeout(() => {
    pendingApplyTimer = null;
    if (!pendingApply) return;
    const {status, isConnected} = pendingApply;
    pendingApply = null;

    const statusChanged = status !== lastKnownStatus;
    const connectedChanged = isConnected !== lastKnownIsConnected;
    lastKnownStatus = status;
    lastKnownIsConnected = isConnected;

    if (connectedChanged) {
      for (const listener of networkListeners) listener(isConnected);
    }
    if (statusChanged) {
      for (const listener of statusListeners) listener(status);
    }
  }, FLAP_DEBOUNCE_MS);
}

let unsubscribeFromNetInfo: (() => void) | null = null;

export function startNetworkStatusMonitoring(): void {
  if (unsubscribeFromNetInfo) return;
  try {
    unsubscribeFromNetInfo = NetInfo.addEventListener(applyNetworkState);
    NetInfo.fetch().then(applyNetworkState).catch(() => {});
  } catch (initialisationError) {
    console.warn(
      '[network] NetInfo unavailable; assuming always online.',
      initialisationError,
    );
  }
}

export function stopNetworkStatusMonitoring(): void {
  unsubscribeFromNetInfo?.();
  unsubscribeFromNetInfo = null;
  if (pendingApplyTimer) {
    clearTimeout(pendingApplyTimer);
    pendingApplyTimer = null;
    pendingApply = null;
  }
}

export function isOnline(): boolean {
  return lastKnownIsConnected;
}

export function getNetworkStatus(): NetworkStatus {
  return lastKnownStatus;
}

export function subscribeToNetworkStatus(
  callback: (isConnected: boolean) => void,
): () => void {
  networkListeners.add(callback);
  return () => {
    networkListeners.delete(callback);
  };
}

export function subscribeToNetworkStatusDetailed(
  callback: (status: NetworkStatus) => void,
): () => void {
  statusListeners.add(callback);
  return () => {
    statusListeners.delete(callback);
  };
}
