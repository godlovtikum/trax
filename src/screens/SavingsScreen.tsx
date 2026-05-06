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
  Modal,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import {SavingsGoalCard} from '../components/SavingsGoalCard';
import {
  getSavingsGoals,
  upsertSavingsGoal,
  deleteSavingsGoal,
  getInvestments,
  addInvestment,
  deleteInvestment,
} from '../lib/database';
import type {SavingsGoal, Investment, InvestmentType} from '../types';

const GOAL_COLORS = [
  '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B',
  '#EF4444', '#EC4899', '#14B8A6', '#F97316',
];
const INV_TYPES: {value: InvestmentType; label: string; icon: string}[] = [
  {value: 'stocks', label: 'Stocks', icon: 'trending-up-outline'},
  {value: 'crypto', label: 'Crypto', icon: 'logo-bitcoin'},
  {value: 'retirement', label: 'Retirement', icon: 'shield-outline'},
  {value: 'bonds', label: 'Bonds', icon: 'document-text-outline'},
  {value: 'real_estate', label: 'Real Estate', icon: 'home-outline'},
  {value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline'},
];

export default function SavingsScreen() {
  const {session} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {primaryCurrency, formatAmount} = useApp();
  const navigation = useNavigation();
  const [tab, setTab] = useState<'goals' | 'investments'>('goals');
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCurrent, setGoalCurrent] = useState('');
  const [goalColor, setGoalColor] = useState(GOAL_COLORS[0]);
  const [goalDeadline, setGoalDeadline] = useState('');
  const [invName, setInvName] = useState('');
  const [invAmount, setInvAmount] = useState('');
  const [invType, setInvType] = useState<InvestmentType>('stocks');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!session) return;
    const [g, i] = await Promise.all([
      getSavingsGoals(session.user.id),
      getInvestments(session.user.id),
    ]);
    setGoals(g);
    setInvestments(i);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [session?.user.id]);

  const handleSaveGoal = async () => {
    const target = parseFloat(goalTarget.replace(/,/g, ''));
    const current = parseFloat(goalCurrent.replace(/,/g, '') || '0');
    if (!goalName.trim() || isNaN(target) || target <= 0) {
      Alert.alert('Invalid', 'Name and target amount are required.');
      return;
    }
    setSaving(true);
    try {
      await upsertSavingsGoal({
        user_id: session!.user.id,
        name: goalName.trim(),
        target_amount: target,
        current_amount: current,
        currency: primaryCurrency,
        color: goalColor,
        deadline: goalDeadline || undefined,
      });
      setShowModal(false);
      setGoalName('');
      setGoalTarget('');
      setGoalCurrent('');
      setGoalDeadline('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const handleSaveInvestment = async () => {
    const amt = parseFloat(invAmount.replace(/,/g, ''));
    if (!invName.trim() || isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid', 'Name and amount are required.');
      return;
    }
    setSaving(true);
    try {
      await addInvestment({
        user_id: session!.user.id,
        name: invName.trim(),
        type: invType,
        amount: amt,
        currency: primaryCurrency,
        date: new Date().toISOString().split('T')[0],
      });
      setShowModal(false);
      setInvName('');
      setInvAmount('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const totalInvested = investments.reduce((s, i) => s + Number(i.amount), 0);

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, {color: colors.foreground}]}>
          Savings & Investments
        </Text>
        <TouchableOpacity onPress={() => setShowModal(true)}>
          <Icon name="add-circle-outline" size={26} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={[styles.tabRow, {backgroundColor: colors.muted}]}>
        {(['goals', 'investments'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && {backgroundColor: colors.card}]}
            onPress={() => setTab(t)}>
            <Text
              style={[
                styles.tabText,
                {color: tab === t ? colors.primary : colors.mutedForeground},
              ]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {paddingBottom: insets.bottom + 40},
        ]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{marginTop: 40}} />
        ) : tab === 'goals' ? (
          goals.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="rocket-outline" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, {color: colors.mutedForeground}]}>
                No savings goals
              </Text>
            </View>
          ) : (
            goals.map(g => (
              <TouchableOpacity
                key={g.id}
                onLongPress={() =>
                  Alert.alert('Delete', `Delete "${g.name}"?`, [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        await deleteSavingsGoal(g.id);
                        await load();
                      },
                    },
                  ])
                }>
                <SavingsGoalCard
                  goal={g}
                  onPress={() =>
                    (navigation as any).navigate('GoalHistory', {goalId: g.id})
                  }
                />
              </TouchableOpacity>
            ))
          )
        ) : (
          <>
            <View
              style={[
                styles.invTotal,
                {
                  backgroundColor: colors.primary + '15',
                  borderColor: colors.primary + '30',
                },
              ]}>
              <Text style={[styles.invTotalLabel, {color: colors.primary}]}>
                Total Invested
              </Text>
              <Text style={[styles.invTotalAmount, {color: colors.primary}]}>
                {formatAmount(totalInvested, primaryCurrency)}
              </Text>
            </View>
            {investments.length === 0 ? (
              <View style={styles.empty}>
                <Icon
                  name="trending-up-outline"
                  size={40}
                  color={colors.mutedForeground}
                />
                <Text style={[styles.emptyText, {color: colors.mutedForeground}]}>
                  No investments logged
                </Text>
              </View>
            ) : (
              investments.map(inv => {
                const t = INV_TYPES.find(it => it.value === inv.type);
                return (
                  <TouchableOpacity
                    key={inv.id}
                    style={[
                      styles.invCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                    onLongPress={() =>
                      Alert.alert('Delete', `Delete "${inv.name}"?`, [
                        {text: 'Cancel', style: 'cancel'},
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: async () => {
                            await deleteInvestment(inv.id);
                            await load();
                          },
                        },
                      ])
                    }>
                    <View
                      style={[
                        styles.invIcon,
                        {backgroundColor: colors.primary + '15'},
                      ]}>
                      <Icon
                        name={(t?.icon ?? 'briefcase-outline') as any}
                        size={20}
                        color={colors.primary}
                      />
                    </View>
                    <View style={styles.invInfo}>
                      <Text style={[styles.invName, {color: colors.foreground}]}>
                        {inv.name}
                      </Text>
                      <Text
                        style={[styles.invType, {color: colors.mutedForeground}]}>
                        {t?.label ?? inv.type}
                      </Text>
                    </View>
                    <Text
                      style={[styles.invAmount, {color: colors.foreground}]}>
                      {formatAmount(inv.amount, inv.currency)}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}>
        <View style={[styles.modalRoot, {backgroundColor: colors.background}]}>
          <View
            style={[
              styles.modalHeader,
              {borderBottomColor: colors.border},
            ]}>
            <Text style={[styles.modalTitle, {color: colors.foreground}]}>
              {tab === 'goals' ? 'New Savings Goal' : 'Log Investment'}
            </Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Icon name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled">
            {tab === 'goals' ? (
              <>
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Goal Name
                </Text>
                <TextInput
                  style={[styles.input, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                  placeholder="e.g. Emergency Fund"
                  placeholderTextColor={colors.mutedForeground}
                  value={goalName}
                  onChangeText={setGoalName}
                />
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Target Amount ({primaryCurrency})
                </Text>
                <TextInput
                  style={[styles.input, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                  placeholder="500000"
                  placeholderTextColor={colors.mutedForeground}
                  value={goalTarget}
                  onChangeText={setGoalTarget}
                  keyboardType="decimal-pad"
                />
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Current Saved ({primaryCurrency})
                </Text>
                <TextInput
                  style={[styles.input, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                  placeholder="0"
                  placeholderTextColor={colors.mutedForeground}
                  value={goalCurrent}
                  onChangeText={setGoalCurrent}
                  keyboardType="decimal-pad"
                />
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Deadline (YYYY-MM-DD, optional)
                </Text>
                <TextInput
                  style={[styles.input, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                  placeholder="2025-12-31"
                  placeholderTextColor={colors.mutedForeground}
                  value={goalDeadline}
                  onChangeText={setGoalDeadline}
                />
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Color
                </Text>
                <View style={styles.colorRow}>
                  {GOAL_COLORS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.colorDot,
                        {backgroundColor: c},
                        goalColor === c && styles.colorDotSelected,
                      ]}
                      onPress={() => setGoalColor(c)}
                    />
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.saveBtn, {backgroundColor: colors.primary, opacity: saving ? 0.7 : 1}]}
                  onPress={handleSaveGoal}
                  disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Goal</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Investment Name
                </Text>
                <TextInput
                  style={[styles.input, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                  placeholder="e.g. Apple Stock"
                  placeholderTextColor={colors.mutedForeground}
                  value={invName}
                  onChangeText={setInvName}
                />
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Type
                </Text>
                <View style={styles.typeGrid}>
                  {INV_TYPES.map(t => (
                    <TouchableOpacity
                      key={t.value}
                      style={[
                        styles.typeChip,
                        {
                          borderColor:
                            invType === t.value ? colors.primary : colors.border,
                          backgroundColor:
                            invType === t.value
                              ? colors.primary + '15'
                              : colors.muted,
                        },
                      ]}
                      onPress={() => setInvType(t.value)}>
                      <Icon
                        name={t.icon as any}
                        size={16}
                        color={
                          invType === t.value
                            ? colors.primary
                            : colors.mutedForeground
                        }
                      />
                      <Text
                        style={[
                          styles.typeChipText,
                          {
                            color:
                              invType === t.value
                                ? colors.primary
                                : colors.foreground,
                          },
                        ]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.label, {color: colors.mutedForeground}]}>
                  Amount ({primaryCurrency})
                </Text>
                <TextInput
                  style={[styles.input, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                  placeholder="100000"
                  placeholderTextColor={colors.mutedForeground}
                  value={invAmount}
                  onChangeText={setInvAmount}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  style={[styles.saveBtn, {backgroundColor: colors.primary, opacity: saving ? 0.7 : 1}]}
                  onPress={handleSaveInvestment}
                  disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Log Investment</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
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
    gap: 12,
  },
  title: {flex: 1, fontSize: 18, fontWeight: '700'},
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  tabBtn: {flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8},
  tabText: {fontSize: 14, fontWeight: '600'},
  scroll: {paddingHorizontal: 16},
  empty: {alignItems: 'center', paddingVertical: 60, gap: 8},
  emptyText: {fontSize: 15, fontWeight: '500'},
  invTotal: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invTotalLabel: {fontSize: 14, fontWeight: '500'},
  invTotalAmount: {fontSize: 20, fontWeight: '700'},
  invCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  invIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invInfo: {flex: 1},
  invName: {fontSize: 14, fontWeight: '600'},
  invType: {fontSize: 12, fontWeight: '400'},
  invAmount: {fontSize: 15, fontWeight: '700'},
  modalRoot: {flex: 1},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {fontSize: 18, fontWeight: '700'},
  modalScroll: {padding: 20},
  label: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
    fontWeight: '400',
  },
  colorRow: {flexDirection: 'row', gap: 10, flexWrap: 'wrap'},
  colorDot: {width: 32, height: 32, borderRadius: 16},
  colorDotSelected: {
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
  },
  typeGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  typeChipText: {fontSize: 13, fontWeight: '500'},
  saveBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
