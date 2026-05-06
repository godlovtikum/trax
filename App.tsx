import React, {useEffect, useState} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import type {LinkingOptions} from '@react-navigation/native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import notifee from '@notifee/react-native';

import {RootNavigator} from './src/navigation/RootNavigator';
import type {RootStackParamList} from './src/navigation/RootNavigator';
import {AuthProvider} from './src/contexts/AuthContext';
import {AppProvider} from './src/contexts/AppContext';
import {ErrorBoundary} from './src/components/ErrorBoundary';
import {OfflineBanner} from './src/components/OfflineBanner';
import {
  initializeOfflineSync,
  subscribeToSyncCompletion as subscribeToOutboxDrain,
} from './src/lib/api';
import {startNetworkStatusMonitoring} from './src/lib/network';
import {
  initializeSync as initializeServerSync,
  subscribeToSyncCompletion as subscribeToServerSync,
} from './src/lib/sync';

// ─── React Query ──────────────────────────────────────────────────────────────

const reactQueryClient = new QueryClient({
  defaultOptions: {
    queries: {retry: 1, staleTime: 30_000},
  },
});

// When the offline write queue finishes draining, refetch every active
// query so the UI reflects the now-persisted state.
subscribeToOutboxDrain(() => {
  reactQueryClient.invalidateQueries();
});

// When the server-sync engine pulls fresh rows from `sync_pull`, also
// invalidate every active query so network-backed screens see new data.
subscribeToServerSync(() => {
  reactQueryClient.invalidateQueries();
});

// ─── Background notification handler ─────────────────────────────────────────

notifee.onBackgroundEvent(async () => {
  // No-op for now — add navigation or analytics hooks here if needed.
});

// ─── Deep linking ─────────────────────────────────────────────────────────────
//
// Maps inbound URLs from the TraX Finance marketing site and the custom
// `trax://` scheme to React Navigation screens.
//
// Website URLs that the app handles:
//   https://trax-finance.netlify.app/          → Home tab (Dashboard)
//   https://trax-finance.netlify.app/login/    → Auth screen (if not signed in)
//   https://trax-finance.netlify.app/register/ → Auth screen (if not signed in)
//   https://trax-finance.netlify.app/dashboard/ → Settings tab
//
// Custom scheme shortcuts:
//   trax://                   → Home tab
//   trax://dashboard          → Settings tab
//   trax://transactions       → Transactions tab
//   trax://reports            → Reports tab
//   trax://add                → Add Transaction modal
//   trax://notifications      → Notification settings screen
//
// For Android App Links (https://) to work without a disambiguation
// dialog, we publish a Digital Asset Links file at:
//   https://trax-finance.netlify.app/.well-known/assetlinks.json
// pointing at the app's SHA-256 signing cert fingerprint.

const deepLinkingConfig: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'https://trax-finance.netlify.app',
    'trax://',
  ],
  config: {
    screens: {
      // Unauthenticated screens — the navigator ignores these when
      // a session exists and redirects to Tabs automatically.
      Auth: {
        screens: {} as any,
        path: 'login',
      },

      // Authenticated stack
      Tabs: {
        screens: {
          Home:         '',              // /  or  trax://
          Transactions: 'transactions',
          Reports:      'reports',
          Settings:     'dashboard',    // /dashboard/ or trax://dashboard
        },
      },

      // Push screens
      NotificationSettings: 'notifications',
      AlertConfigs:         'alert-configs',
      Budget:               'budget',
      Savings:              'savings',
      Categories:           'categories',
      GoalHistory:          'savings/goal/:goalId',

      // Modal
      AddTransaction: 'add',
    },
  },
};

// ─── App component ────────────────────────────────────────────────────────────

export default function App() {
  const [hasFinishedInitialPaint, setHasFinishedInitialPaint] = useState(false);

  useEffect(() => {
    initializeOfflineSync();
    startNetworkStatusMonitoring();
    initializeServerSync();
    const initialPaintTimer = setTimeout(() => setHasFinishedInitialPaint(true), 0);
    return () => clearTimeout(initialPaintTimer);
  }, []);

  if (!hasFinishedInitialPaint) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashText}>TraX</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={reactQueryClient}>
          <GestureHandlerRootView style={styles.flex}>
            <KeyboardProvider>
              <AuthProvider>
                <AppProvider>
                  {/*
                    OfflineBanner sits ABOVE the navigator so it survives
                    screen transitions. It self-hides when the device is
                    online and the outbox is empty.
                  */}
                  <OfflineBanner />
                  <NavigationContainer linking={deepLinkingConfig}>
                    <RootNavigator />
                  </NavigationContainer>
                </AppProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  splash: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: '#1A56DB',
  },
  splashText: {
    fontSize:    40,
    color:       '#fff',
    fontWeight:  'bold',
    letterSpacing: -1,
  },
});
