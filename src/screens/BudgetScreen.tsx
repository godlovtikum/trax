import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import {BudgetProgressBar} from '../components/BudgetProgressBar';
import {
  getBudgetUsage,
  getCategories,
  upsertBudget,
  deleteBudget,
} from '../lib/database';
import type {Budget, Category} from '../types';

export default function BudgetScreen() {
  const {session} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {primaryCurrency} = useApp();
  const navigation = useNavigation();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selCat, setSelCat] = useState<Category | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!session) return;
    const [b, c] = await Promise.all([
      getBudgetUsage(session.user.id),
      getCategories(session.user.id),
    ]);
    setBudgets(b);
    setCategories(c.filter(cat => cat.type === 'expense' || cat.type === 'both'));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [session?.user.id]);

  const handleAdd = async () => {
    const num = parseFloat(amount.replace(/,/g, ''));
    if (!amount || isNaN(num) || num <= 0) {
      Alert.alert('Invalid', 'Enter a valid budget amount.');
      return;
    }
    setSaving(true);
    try {
      await upsertBudget({
        user_id: session!.user.id,
        category_id: selCat?.id,
        amount: num,
        period: 'monthly',
        currency: primaryCurrency,
      });
      setShowAdd(false);
      setSelCat(null);
      setAmount('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const handleDelete = (b: Budget) => {
    Alert.alert(
      'Remove Budget',
      `Remove budget for ${b.category?.name ?? 'overall'}?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteBudget(b.id);
            await load();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}>
          <Icon name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, {color: colors.foreground}]}>Budgets</Text>
        <TouchableOpacity onPress={() => setShowAdd(v => !v)}>
          <Icon
            name={showAdd ? 'close' : 'add-circle-outline'}
            size={26}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {paddingBottom: insets.bottom + 40},
        ]}>
        {showAdd && (
          <View
            style={[
              styles.addForm,
              {backgroundColor: colors.card, borderColor: colors.border},
            ]}>
            <Text style={[styles.formTitle, {color: colors.foreground}]}>
              New Budget
            </Text>

            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Category (leave blank for overall)
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.catScroll}>
              <TouchableOpacity
                style={[
                  styles.catChip,
                  {
                    borderColor: !selCat ? colors.primary : colors.border,
                    backgroundColor: !selCat
                      ? colors.primary + '15'
                      : colors.muted,
                  },
                ]}
                onPress={() => setSelCat(null)}>
                <Text
                  style={[
                    styles.catText,
                    {color: !selCat ? colors.primary : colors.mutedForeground},
                  ]}>
                  Overall
                </Text>
              </TouchableOpacity>
              {categories.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.catChip,
                    {
                      borderColor:
                        selCat?.id === c.id ? c.color : colors.border,
                      backgroundColor:
                        selCat?.id === c.id ? c.color + '15' : colors.muted,
                    },
                  ]}
                  onPress={() => setSelCat(c)}>
                  <Icon name={c.icon as any} size={14} color={c.color} />
                  <Text
                    style={[
                      styles.catText,
                      {
                        color:
                          selCat?.id === c.id ? c.color : colors.foreground,
                      },
                    ]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Monthly Limit ({primaryCurrency})
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              placeholder="e.g. 50000"
              placeholderTextColor={colors.mutedForeground}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />

            <TouchableOpacity
              style={[
                styles.saveBtn,
                {backgroundColor: colors.primary, opacity: saving ? 0.7 : 1},
              ]}
              onPress={handleAdd}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save Budget</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{marginTop: 40}} />
        ) : budgets.length === 0 ? (
          <View style={styles.empty}>
            <Icon
              name="pie-chart-outline"
              size={40}
              color={colors.mutedForeground}
            />
            <Text style={[styles.emptyText, {color: colors.mutedForeground}]}>
              No budgets set
            </Text>
            <Text style={[styles.emptySub, {color: colors.mutedForeground}]}>
              Tap + to add your first budget
            </Text>
          </View>
        ) : (
          budgets.map(b => (
            <TouchableOpacity
              key={b.id}
              onLongPress={() => handleDelete(b)}
              activeOpacity={0.9}>
              <BudgetProgressBar budget={b} />
            </TouchableOpacity>
          ))
        )}

        <Text style={[styles.hint, {color: colors.mutedForeground}]}>
          Long press a budget to remove it
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn: {marginRight: 12},
  title: {flex: 1, fontSize: 22, fontWeight: '700'},
  scroll: {padding: 16},
  addForm: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
  },
  formTitle: {fontSize: 16, fontWeight: '700'},
  label: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  catScroll: {marginHorizontal: -16, paddingHorizontal: 4, marginBottom: 4},
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  catText: {fontSize: 13, fontWeight: '500'},
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
    fontWeight: '400',
  },
  saveBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  empty: {alignItems: 'center', paddingVertical: 60, gap: 8},
  emptyText: {fontSize: 16, fontWeight: '600'},
  emptySub: {fontSize: 13, fontWeight: '400'},
  hint: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 8,
  },
});
