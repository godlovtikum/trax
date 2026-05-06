import React, {memo, useEffect} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import type {Budget} from '../types';

interface BudgetProgressBarProps {
  budget: Budget;
}

function BudgetProgressBarImpl({budget}: BudgetProgressBarProps) {
  const colors = useColors();
  const {formatAmount} = useApp();
  const pct = budget.percentage ?? 0;
  const isOver = pct >= 100;
  const isWarning = pct >= 80 && pct < 100;
  const barColor = isOver
    ? colors.expense
    : isWarning
    ? '#F59E0B'
    : colors.primary;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(Math.min(pct / 100, 1), {duration: 700});
  }, [pct, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as any,
  }));

  return (
    <View
      style={[
        styles.container,
        {backgroundColor: colors.card, borderColor: colors.border},
      ]}>
      <View style={styles.row}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor:
                (budget.category?.color ?? colors.primary) + '20',
            },
          ]}>
          <Icon
            name={(budget.category?.icon ?? 'wallet-outline') as any}
            size={16}
            color={budget.category?.color ?? colors.primary}
          />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, {color: colors.foreground}]}>
            {budget.category?.name ?? 'Overall Budget'}
          </Text>
          <Text style={[styles.sub, {color: colors.mutedForeground}]}>
            {formatAmount(budget.spent ?? 0)} of {formatAmount(budget.amount)}
          </Text>
        </View>
        <Text
          style={[
            styles.pct,
            {
              color: isOver
                ? colors.expense
                : isWarning
                ? '#F59E0B'
                : colors.mutedForeground,
            },
          ]}>
          {Math.round(pct)}%
        </Text>
      </View>
      <View style={[styles.track, {backgroundColor: colors.muted}]}>
        <Animated.View
          style={[styles.fill, animatedStyle, {backgroundColor: barColor}]}
        />
      </View>
      {isOver && (
        <Text style={[styles.overMsg, {color: colors.expense}]}>
          Over by {formatAmount(Math.abs(budget.remaining ?? 0))}
        </Text>
      )}
    </View>
  );
}

export const BudgetProgressBar = memo(
  BudgetProgressBarImpl,
  (prev, next) =>
    prev.budget.id === next.budget.id &&
    prev.budget.amount === next.budget.amount &&
    prev.budget.spent === next.budget.spent &&
    prev.budget.percentage === next.budget.percentage &&
    prev.budget.remaining === next.budget.remaining &&
    prev.budget.category?.id === next.budget.category?.id &&
    prev.budget.category?.color === next.budget.category?.color &&
    prev.budget.category?.icon === next.budget.category?.icon &&
    prev.budget.category?.name === next.budget.category?.name,
);

const styles = StyleSheet.create({
  container: {padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {flex: 1},
  name: {fontSize: 13, fontWeight: '600'},
  sub: {fontSize: 11, fontWeight: '400', marginTop: 1},
  pct: {fontSize: 13, fontWeight: '700'},
  track: {height: 6, borderRadius: 3, overflow: 'hidden'},
  fill: {height: 6, borderRadius: 3},
  overMsg: {fontSize: 11, fontWeight: '500', marginTop: 6},
});
