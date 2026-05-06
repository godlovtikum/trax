import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '../../contexts/AuthContext';
import {useColors} from '../../hooks/useColors';
import {useApp} from '../../contexts/AppContext';
import {DonutChart} from '../../components/DonutChart';
import {BarChart} from '../../components/BarChart';
import {
  getMonthlyStats,
  getMonthlySeries,
  getCategoryBreakdown,
} from '../../lib/database';

type Period = '30d' | '90d' | '6m' | '1y';

const PERIODS: {label: string; value: Period; months: number}[] = [
  {label: '30d', value: '30d', months: 1},
  {label: '3m', value: '90d', months: 3},
  {label: '6m', value: '6m', months: 6},
  {label: '1y', value: '1y', months: 12},
];

export default function ReportsScreen() {
  const {session} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {formatAmount, primaryCurrency} = useApp();
  const [period, setPeriod] = useState<Period>('6m');

  const userId = session!.user.id;
  const now = new Date();

  const p = PERIODS.find(pr => pr.value === period)!;
  const startDate = new Date(now);
  startDate.setMonth(now.getMonth() - p.months + 1, 1);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = now.toISOString().split('T')[0];

  const statsQ = useQuery({
    queryKey: ['monthly-stats-current', userId],
    queryFn: () =>
      getMonthlyStats(userId, now.getFullYear(), now.getMonth() + 1),
  });

  const seriesQ = useQuery({
    queryKey: ['monthly-series', userId, period],
    queryFn: () => getMonthlySeries(userId, p.months),
  });

  const breakdownQ = useQuery({
    queryKey: ['category-breakdown', userId, period],
    queryFn: () => getCategoryBreakdown(userId, startStr, endStr),
  });

  const stats = statsQ.data ?? {income: 0, expense: 0, balance: 0};
  const series = seriesQ.data ?? [];
  const breakdown = breakdownQ.data ?? [];
  const totalExpense = breakdown.reduce((s, d) => s + d.total, 0);
  const savingsRate =
    stats.income > 0
      ? Math.max(0, ((stats.income - stats.expense) / stats.income) * 100)
      : 0;

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={[styles.title, {color: colors.foreground}]}>Reports</Text>
        <View style={[styles.periodRow, {backgroundColor: colors.muted}]}>
          {PERIODS.map(pr => (
            <TouchableOpacity
              key={pr.value}
              style={[
                styles.periodBtn,
                period === pr.value && {backgroundColor: colors.card},
              ]}
              onPress={() => setPeriod(pr.value)}>
              <Text
                style={[
                  styles.periodText,
                  {
                    color:
                      period === pr.value
                        ? colors.primary
                        : colors.mutedForeground,
                  },
                ]}>
                {pr.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {paddingBottom: insets.bottom + 90},
        ]}>
        <View style={styles.summaryRow}>
          {[
            {
              label: 'Income',
              amount: stats.income,
              color: colors.income,
              icon: 'arrow-down-circle-outline' as const,
            },
            {
              label: 'Expense',
              amount: stats.expense,
              color: colors.expense,
              icon: 'arrow-up-circle-outline' as const,
            },
          ].map(s => (
            <View
              key={s.label}
              style={[
                styles.summaryCard,
                {backgroundColor: colors.card, borderColor: colors.border},
              ]}>
              <Icon name={s.icon} size={20} color={s.color} />
              <Text style={[styles.summaryLabel, {color: colors.mutedForeground}]}>
                {s.label}
              </Text>
              <Text
                style={[styles.summaryAmount, {color: colors.foreground}]}
                numberOfLines={1}>
                {formatAmount(s.amount, primaryCurrency)}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.savingsCard,
            {
              backgroundColor: colors.primary + '15',
              borderColor: colors.primary + '30',
            },
          ]}>
          <Text style={[styles.savingsLabel, {color: colors.primary}]}>
            Savings Rate
          </Text>
          <Text style={[styles.savingsRate, {color: colors.primary}]}>
            {savingsRate.toFixed(1)}%
          </Text>
          <Text style={[styles.savingsSub, {color: colors.mutedForeground}]}>
            of income saved this month
          </Text>
        </View>

        <View
          style={[
            styles.chartCard,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.chartTitle, {color: colors.foreground}]}>
            Spending by Category
          </Text>
          {breakdownQ.isLoading ? (
            <ActivityIndicator
              color={colors.primary}
              style={{marginVertical: 20}}
            />
          ) : breakdown.length === 0 ? (
            <View style={styles.emptyChart}>
              <Text
                style={[styles.emptyChartText, {color: colors.mutedForeground}]}>
                No expense data
              </Text>
            </View>
          ) : (
            <View style={styles.donutRow}>
              <DonutChart
                data={breakdown.map(d => ({
                  value: d.total,
                  color: d.color,
                  label: d.name,
                }))}
                size={160}
                centerLabel={formatAmount(totalExpense, primaryCurrency)}
                centerSublabel="Total"
              />
              <View style={styles.legend}>
                {breakdown.slice(0, 5).map((d, i) => (
                  <View key={i} style={styles.legendItem}>
                    <View
                      style={[styles.legendDot, {backgroundColor: d.color}]}
                    />
                    <Text
                      style={[styles.legendName, {color: colors.foreground}]}
                      numberOfLines={1}>
                      {d.name}
                    </Text>
                    <Text
                      style={[
                        styles.legendPct,
                        {color: colors.mutedForeground},
                      ]}>
                      {((d.total / totalExpense) * 100).toFixed(0)}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        <View
          style={[
            styles.chartCard,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.chartTitle, {color: colors.foreground}]}>
            Monthly Trend
          </Text>
          {seriesQ.isLoading ? (
            <ActivityIndicator
              color={colors.primary}
              style={{marginVertical: 20}}
            />
          ) : series.length === 0 ? (
            <View style={styles.emptyChart}>
              <Text
                style={[styles.emptyChartText, {color: colors.mutedForeground}]}>
                No data
              </Text>
            </View>
          ) : (
            <BarChart data={series} width={320} height={160} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {paddingHorizontal: 20, paddingBottom: 8},
  title: {fontSize: 28, fontWeight: '700', marginBottom: 12},
  periodRow: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    alignSelf: 'flex-start',
  },
  periodBtn: {paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6},
  periodText: {fontSize: 13, fontWeight: '600'},
  scroll: {paddingHorizontal: 16, paddingTop: 12, gap: 12},
  summaryRow: {flexDirection: 'row', gap: 10},
  summaryCard: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryAmount: {fontSize: 15, fontWeight: '700'},
  savingsCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  savingsLabel: {fontSize: 13, fontWeight: '600', flex: 1},
  savingsRate: {fontSize: 22, fontWeight: '700'},
  savingsSub: {
    fontSize: 11,
    fontWeight: '400',
    position: 'absolute',
    bottom: 6,
    left: 16,
  },
  chartCard: {padding: 16, borderRadius: 14, borderWidth: 1},
  chartTitle: {fontSize: 15, fontWeight: '700', marginBottom: 14},
  donutRow: {flexDirection: 'row', alignItems: 'center', gap: 16},
  legend: {flex: 1, gap: 6},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 8},
  legendDot: {width: 8, height: 8, borderRadius: 4},
  legendName: {flex: 1, fontSize: 12, fontWeight: '500'},
  legendPct: {fontSize: 11, fontWeight: '400'},
  emptyChart: {alignItems: 'center', paddingVertical: 24},
  emptyChartText: {fontSize: 14, fontWeight: '400'},
});
