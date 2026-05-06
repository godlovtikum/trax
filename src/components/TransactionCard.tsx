import React, {memo, useCallback} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import type {Transaction} from '../types';

interface TransactionCardProps {
  transaction: Transaction;
  onPress?: () => void;
  onDelete?: () => void;
}

function TransactionCardImpl({
  transaction,
  onPress,
  onDelete,
}: TransactionCardProps) {
  const colors = useColors();
  const {formatAmount} = useApp();
  const isIncome = transaction.type === 'income';
  const cat = transaction.category;

  const formatDate = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en', {month: 'short', day: 'numeric'});
  }, []);

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {backgroundColor: colors.card, borderColor: colors.border},
      ]}
      onPress={onPress}
      activeOpacity={0.7}>
      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor: cat?.color ? cat.color + '20' : colors.muted,
          },
        ]}>
        <Icon
          name={(cat?.icon ?? 'pricetag-outline') as any}
          size={20}
          color={cat?.color ?? colors.mutedForeground}
        />
      </View>
      <View style={styles.info}>
        <Text
          style={[styles.name, {color: colors.foreground}]}
          numberOfLines={1}>
          {cat?.name ?? 'Uncategorized'}
        </Text>
        {transaction.description ? (
          <Text
            style={[styles.desc, {color: colors.mutedForeground}]}
            numberOfLines={1}>
            {transaction.description}
          </Text>
        ) : (
          <Text style={[styles.desc, {color: colors.mutedForeground}]}>
            {formatDate(transaction.date)}
          </Text>
        )}
      </View>
      <View style={styles.right}>
        <Text
          style={[
            styles.amount,
            {color: isIncome ? colors.income : colors.expense},
          ]}>
          {isIncome ? '+' : '-'}{' '}
          {formatAmount(transaction.amount, transaction.currency)}
        </Text>
        {transaction.description ? (
          <Text style={[styles.date, {color: colors.mutedForeground}]}>
            {formatDate(transaction.date)}
          </Text>
        ) : null}
      </View>
      {onDelete && (
        <TouchableOpacity
          onPress={onDelete}
          style={styles.deleteBtn}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="trash-outline" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// Long transaction lists re-render every row whenever the parent's state
// changes (filter selection, refresh, etc.). React.memo + a shallow check
// on the transaction's mutable fields means we only redraw the rows that
// actually changed — a big win on entry-level Android devices.
function areEqual(prev: TransactionCardProps, next: TransactionCardProps) {
  if (prev.onPress !== next.onPress) return false;
  if (prev.onDelete !== next.onDelete) return false;
  const a = prev.transaction;
  const b = next.transaction;
  return (
    a.id === b.id &&
    a.amount === b.amount &&
    a.type === b.type &&
    a.currency === b.currency &&
    a.description === b.description &&
    a.date === b.date &&
    a.category?.id === b.category?.id &&
    a.category?.name === b.category?.name &&
    a.category?.color === b.category?.color &&
    a.category?.icon === b.category?.icon
  );
}

export const TransactionCard = memo(TransactionCardImpl, areEqual);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {flex: 1, minWidth: 0},
  name: {fontSize: 14, fontWeight: '600'},
  desc: {fontSize: 12, fontWeight: '400', marginTop: 2},
  right: {alignItems: 'flex-end'},
  amount: {fontSize: 14, fontWeight: '700'},
  date: {fontSize: 11, fontWeight: '400', marginTop: 2},
  deleteBtn: {paddingLeft: 4},
});
