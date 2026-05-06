import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  DevSettings,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({error, resetError}: ErrorFallbackProps) {
  const handleReload = () => {
    if (__DEV__ && Platform.OS !== 'web') {
      DevSettings.reload();
    } else {
      resetError();
    }
  };

  return (
    <View style={styles.root}>
      <Icon name="alert-triangle" size={48} color="#EF4444" />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{error?.message ?? 'An unexpected error occurred.'}</Text>
      <TouchableOpacity style={styles.btn} onPress={handleReload}>
        <Text style={styles.btnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#F7F9FC',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 16,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    fontWeight: '400',
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  btn: {
    backgroundColor: '#1A56DB',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
