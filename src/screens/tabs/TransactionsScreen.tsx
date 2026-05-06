import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../../contexts/AuthContext';
import {useColors} from '../../hooks/useColors';
import {TransactionCard} from '../../components/TransactionCard';
import {getTransactions, deleteTransaction} from '../../lib/database';
import type {Transaction, TransactionType} from '../../types';
import type {RootStackParamList} from '../../navigation/RootNavigator';

type Filter = 'all' | TransactionType;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function TransactionsScreen() {
  const {session} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const navigation = useNavigation<Nav>();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const userId = session!.user.id;

  const {data: transactions = [], refetch} = useQuery({
    queryKey: ['transactions', userId, filter],
    queryFn: () =>
      getTransactions(userId, filter !== 'all' ? {type: filter} : undefined),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, []);

  const handleDelete = (t: Transaction) => {
    Alert.alert('Delete Transaction', `Delete this ${t.type}?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(t.id);
          qc.invalidateQueries({queryKey: ['transactions']});
          qc.invalidateQueries({queryKey: ['monthly-stats']});
          qc.invalidateQueries({queryKey: ['budget-usage']});
          qc.invalidateQueries({queryKey: ['transactions-recent']});
        },
      },
    ]);
  };

  const filtered = transactions.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.category?.name.toLowerCase().includes(s) ||
      t.description?.toLowerCase().includes(s)
    );
  });

  const grouped: {title: string; data: Transaction[]}[] = [];
  const seen = new Set<string>();
  filtered.forEach(t => {
    if (!seen.has(t.date)) {
      seen.add(t.date);
      grouped.push({title: t.date, data: []});
    }
    grouped[grouped.length - 1].data.push(t);
  });

  const formatGroupDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={[styles.title, {color: colors.foreground}]}>
          Transactions
        </Text>
      </View>

      <View
        style={[
          styles.searchWrap,
          {backgroundColor: colors.input, borderColor: colors.border},
        ]}>
        <Icon name="search-outline" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, {color: colors.foreground}]}
          placeholder="Search transactions..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Icon
              name="close-circle"
              size={16}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.chips}>
        {(['all', 'income', 'expense'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[
              styles.chip,
              {
                backgroundColor: filter === f ? colors.primary : colors.card,
                borderColor: filter === f ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setFilter(f)}>
            <Text
              style={[
                styles.chipText,
                {color: filter === f ? '#fff' : colors.mutedForeground},
              ]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={grouped}
        keyExtractor={item => item.title}
        renderItem={({item}) => (
          <View style={styles.group}>
            <Text
              style={[
                styles.groupLabel,
                {color: colors.mutedForeground},
              ]}>
              {formatGroupDate(item.title)}
            </Text>
            {item.data.map(t => (
              <TransactionCard
                key={t.id}
                transaction={t}
                onDelete={() => handleDelete(t)}
              />
            ))}
          </View>
        )}
        contentContainerStyle={[
          styles.list,
          {paddingBottom: insets.bottom + 100},
          filtered.length === 0 && {flex: 1},
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={filtered.length > 0}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon
              name="receipt-outline"
              size={40}
              color={colors.mutedForeground}
            />
            <Text style={[styles.emptyText, {color: colors.mutedForeground}]}>
              No transactions found
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      />

      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: insets.bottom + 80,
          },
        ]}
        onPress={() => navigation.navigate('AddTransaction')}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {paddingHorizontal: 20, paddingBottom: 12},
  title: {fontSize: 28, fontWeight: '700'},
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {flex: 1, fontSize: 14, fontWeight: '400'},
  chips: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  chip: {paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1},
  chipText: {fontSize: 13, fontWeight: '500'},
  list: {paddingHorizontal: 16, paddingTop: 4},
  group: {marginBottom: 8},
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 2,
  },
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  emptyText: {fontSize: 15, fontWeight: '500'},
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
