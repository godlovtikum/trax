import React, {useCallback, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '../../contexts/AuthContext';
import {useColors} from '../../hooks/useColors';
import {BalanceCard} from '../../components/BalanceCard';
import {BudgetProgressBar} from '../../components/BudgetProgressBar';
import {TransactionCard} from '../../components/TransactionCard';
import {getMonthlyStats, getBudgetUsage, getTransactions} from '../../lib/database';
import type {RootStackParamList} from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function DashboardScreen() {
  const {session, profile} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [refreshing, setRefreshing] = useState(false);

  const userId = session!.user.id;
  const now = new Date();
  const monthLabel = now.toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
  });

  const statsQ = useQuery({
    queryKey: ['monthly-stats', userId, now.getFullYear(), now.getMonth()],
    queryFn: () =>
      getMonthlyStats(userId, now.getFullYear(), now.getMonth() + 1),
  });

  const budgetsQ = useQuery({
    queryKey: ['budget-usage', userId],
    queryFn: () => getBudgetUsage(userId),
  });

  const txnQ = useQuery({
    queryKey: ['transactions-recent', userId],
    queryFn: () => getTransactions(userId, {limit: 5}),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([statsQ.refetch(), budgetsQ.refetch(), txnQ.refetch()]);
    setRefreshing(false);
  }, []);

  const greeting = () => {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';
  const stats = statsQ.data ?? {income: 0, expense: 0, balance: 0};
  const budgets = (budgetsQ.data ?? []).slice(0, 3);
  const transactions = txnQ.data ?? [];

  const topPadding = insets.top;

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View
        style={[
          styles.header,
          {paddingTop: topPadding + 12, backgroundColor: colors.background},
        ]}>
        <View>
          <Text style={[styles.greeting, {color: colors.mutedForeground}]}>
            {greeting()},
          </Text>
          <Text style={[styles.name, {color: colors.foreground}]}>
            {firstName}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.bellBtn,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}
          onPress={() => navigation.navigate('NotificationSettings')}>
          <Icon
            name="notifications-outline"
            size={20}
            color={colors.foreground}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.scroll,
          {paddingBottom: insets.bottom + 100},
        ]}>
        <BalanceCard
          balance={stats.balance}
          income={stats.income}
          expense={stats.expense}
          month={monthLabel}
        />

        {budgets.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, {color: colors.foreground}]}>
                Budgets
              </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Budget')}>
                <Text style={[styles.seeAll, {color: colors.primary}]}>
                  See all
                </Text>
              </TouchableOpacity>
            </View>
            {budgets.map(b => (
              <BudgetProgressBar key={b.id} budget={b} />
            ))}
          </View>
        )}

        {budgets.length === 0 && !budgetsQ.isLoading && (
          <TouchableOpacity
            style={[
              styles.emptyBudget,
              {backgroundColor: colors.card, borderColor: colors.border},
            ]}
            onPress={() => navigation.navigate('Budget')}>
            <Icon
              name="pie-chart-outline"
              size={22}
              color={colors.primary}
            />
            <Text
              style={[styles.emptyBudgetText, {color: colors.foreground}]}>
              Set up budgets
            </Text>
            <Icon
              name="chevron-forward"
              size={16}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, {color: colors.foreground}]}>
              Recent
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Transactions' as any)}>
              <Text style={[styles.seeAll, {color: colors.primary}]}>
                See all
              </Text>
            </TouchableOpacity>
          </View>
          {transactions.length === 0 && !txnQ.isLoading ? (
            <View
              style={[
                styles.emptyTxn,
                {backgroundColor: colors.card, borderColor: colors.border},
              ]}>
              <Icon
                name="receipt-outline"
                size={32}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyTxnText, {color: colors.mutedForeground}]}>
                No transactions yet
              </Text>
              <Text
                style={[styles.emptyTxnSub, {color: colors.mutedForeground}]}>
                Tap + to add your first one
              </Text>
            </View>
          ) : (
            transactions.map(t => (
              <TransactionCard key={t.id} transaction={t} />
            ))
          )}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: insets.bottom + 80,
          },
        ]}
        onPress={() => navigation.navigate('AddTransaction')}
        activeOpacity={0.85}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  greeting: {fontSize: 13, fontWeight: '400'},
  name: {fontSize: 22, fontWeight: '700'},
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  scroll: {paddingTop: 4, gap: 0},
  section: {paddingHorizontal: 16, marginTop: 24},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {fontSize: 17, fontWeight: '700'},
  seeAll: {fontSize: 13, fontWeight: '500'},
  emptyBudget: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyBudgetText: {flex: 1, fontSize: 14, fontWeight: '500'},
  emptyTxn: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  emptyTxnText: {fontSize: 15, fontWeight: '600'},
  emptyTxnSub: {fontSize: 12, fontWeight: '400'},
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A56DB',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 8,
  },
});
