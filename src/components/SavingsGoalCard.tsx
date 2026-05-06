import React, {memo, useEffect} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import type {SavingsGoal} from '../types';

interface SavingsGoalCardProps {
  goal: SavingsGoal;
  onPress?: () => void;
}

function SavingsGoalCardImpl({goal, onPress}: SavingsGoalCardProps) {
  const colors = useColors();
  const {formatAmount} = useApp();
  const pct = Math.min((goal.current_amount / goal.target_amount) * 100, 100);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(pct / 100, {duration: 800});
  }, [pct, progress]);

  const animStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as any,
  }));

  const daysLeft = goal.deadline
    ? Math.max(
        0,
        Math.ceil(
          (new Date(goal.deadline).getTime() - Date.now()) / 86400000,
        ),
      )
    : null;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {backgroundColor: colors.card, borderColor: colors.border},
      ]}
      onPress={onPress}
      activeOpacity={0.8}>
      <View style={styles.header}>
        <View style={[styles.colorDot, {backgroundColor: goal.color}]} />
        <Text
          style={[styles.name, {color: colors.foreground}]}
          numberOfLines={1}>
          {goal.name}
        </Text>
        {daysLeft !== null && (
          <Text style={[styles.days, {color: colors.mutedForeground}]}>
            {daysLeft}d left
          </Text>
        )}
      </View>
      <View style={styles.amounts}>
        <Text style={[styles.current, {color: goal.color}]}>
          {formatAmount(goal.current_amount, goal.currency)}
        </Text>
        <Text style={[styles.target, {color: colors.mutedForeground}]}>
          of {formatAmount(goal.target_amount, goal.currency)}
        </Text>
      </View>
      <View style={[styles.track, {backgroundColor: colors.muted}]}>
        <Animated.View
          style={[styles.fill, animStyle, {backgroundColor: goal.color}]}
        />
      </View>
      <Text style={[styles.pct, {color: colors.mutedForeground}]}>
        {Math.round(pct)}% complete
      </Text>
    </TouchableOpacity>
  );
}

export const SavingsGoalCard = memo(
  SavingsGoalCardImpl,
  (prev, next) =>
    prev.onPress === next.onPress &&
    prev.goal.id === next.goal.id &&
    prev.goal.name === next.goal.name &&
    prev.goal.color === next.goal.color &&
    prev.goal.currency === next.goal.currency &&
    prev.goal.current_amount === next.goal.current_amount &&
    prev.goal.target_amount === next.goal.target_amount &&
    prev.goal.deadline === next.goal.deadline,
);

const styles = StyleSheet.create({
  card: {padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 10},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  colorDot: {width: 10, height: 10, borderRadius: 5},
  name: {flex: 1, fontSize: 14, fontWeight: '600'},
  days: {fontSize: 11, fontWeight: '400'},
  amounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 10,
  },
  current: {fontSize: 20, fontWeight: '700'},
  target: {fontSize: 12, fontWeight: '400'},
  track: {height: 8, borderRadius: 4, overflow: 'hidden'},
  fill: {height: 8, borderRadius: 4},
  pct: {fontSize: 11, fontWeight: '400', marginTop: 6},
});
