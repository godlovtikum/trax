import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useColors } from '../hooks/useColors';
import { useApp } from '../contexts/AppContext';

interface BalanceCardProps {
  balance: number;
  income: number;
  expense: number;
  month?: string;
  currency?: string;
}

export function BalanceCard({ balance, income, expense, month, currency }: BalanceCardProps) {
  const colors = useColors();
  const { formatAmount } = useApp();

  return (
    <LinearGradient
      colors={balance >= 0 ? ['#1A56DB', '#0EA5E9'] : ['#EF4444', '#F97316']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, { borderRadius: colors.radius }]}
    >
      <View style={styles.header}>
        <Text style={styles.label}>Net Balance</Text>
        {month && <Text style={styles.month}>{month}</Text>}
      </View>
      <Text style={styles.balance}>{formatAmount(Math.abs(balance), currency)}</Text>
      {balance < 0 && <Text style={styles.negNote}>Overspending this month</Text>}

      <View style={styles.divider} />

      <View style={styles.row}>
        <View style={styles.col}>
          <View style={styles.colHeader}>
            <View style={[styles.dot, { backgroundColor: 'rgba(255,255,255,0.6)' }]}>
              <Icon name="arrow-down-outline" size={10} color="#fff" />
            </View>
            <Text style={styles.colLabel}>Income</Text>
          </View>
          <Text style={styles.colAmount}>{formatAmount(income, currency)}</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.col}>
          <View style={styles.colHeader}>
            <View style={[styles.dot, { backgroundColor: 'rgba(255,255,255,0.6)' }]}>
              <Icon name="arrow-up-outline" size={10} color="#fff" />
            </View>
            <Text style={styles.colLabel}>Expenses</Text>
          </View>
          <Text style={styles.colAmount}>{formatAmount(expense, currency)}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { padding: 22, marginHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '500' },
  month: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '400' },
  balance: { color: '#fff', fontSize: 36, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  negNote: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '400', marginBottom: 4 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 14 },
  row: { flexDirection: 'row' },
  col: { flex: 1 },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  colLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '400' },
  colAmount: { color: '#fff', fontSize: 16, fontWeight: '600' },
  separator: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 16 },
});
