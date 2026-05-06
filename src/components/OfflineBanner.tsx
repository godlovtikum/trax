/**
 * OfflineBanner — global status strip shown above the navigator.
 *
 * Surfaces two states the user otherwise can't see:
 *   • Device is offline (no internet right now).
 *   • Device is online but writes are still queued (replay in progress).
 *
 * The banner stays out of the way otherwise — when everything is healthy
 * it renders nothing. Tapping it does nothing yet; future versions could
 * open a "pending changes" inspector.
 */

import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import {
  getNetworkStatus,
  subscribeToNetworkStatusDetailed,
  type NetworkStatus,
} from '../lib/network';
import {
  getQueueSize,
  getDeadLetterSize,
  subscribeToQueueChanges,
} from '../lib/queue';

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<NetworkStatus>(getNetworkStatus());
  const [pendingCount, setPendingCount] = useState(getQueueSize());
  const [deadCount, setDeadCount] = useState(getDeadLetterSize());

  useEffect(() => {
    return subscribeToNetworkStatusDetailed(setStatus);
  }, []);

  useEffect(() => {
    return subscribeToQueueChanges(() => {
      setPendingCount(getQueueSize());
      setDeadCount(getDeadLetterSize());
    });
  }, []);

  const isOffline = status === 'offline';
  const hasPending = pendingCount > 0;
  const hasDead = deadCount > 0;

  if (!isOffline && !hasPending && !hasDead) return null;

  let backgroundColor = '#0F172A';
  let icon: 'wifi-off' | 'upload-cloud' | 'alert-triangle' = 'upload-cloud';
  let label = '';

  if (isOffline) {
    backgroundColor = '#0F172A';
    icon = 'wifi-off';
    label = hasPending
      ? `You're offline · ${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting`
      : "You're offline";
  } else if (hasDead) {
    backgroundColor = '#B91C1C';
    icon = 'alert-triangle';
    label = `${deadCount} change${deadCount === 1 ? '' : 's'} couldn't sync`;
  } else if (hasPending) {
    backgroundColor = '#1A56DB';
    icon = 'upload-cloud';
    label = `Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}…`;
  }

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 8),
          backgroundColor,
        },
      ]}>
      <Icon name={icon} size={14} color="#fff" />
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
