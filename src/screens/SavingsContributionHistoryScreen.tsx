// Contribution History — timeline of every deposit made toward one savings
// goal, with running stats (average monthly contribution, projected
// completion date based on average pace) and an inline "Add Contribution"
// sheet.

import React, {useState, useEffect, useCallback} from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    TextInput,
    Alert,
    ActivityIndicator,
    Modal,
    RefreshControl,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated';

import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import {
    getSavingsGoal,
    getSavingsContributions,
    addSavingsContribution,
} from '../lib/database';
import type {SavingsGoal, SavingsContribution} from '../types';
import type {RootStackParamList} from '../navigation/RootNavigator';

// ── Projected completion helper ───────────────────────────────────────────

function computeProjectedCompletion(
    contributions: SavingsContribution[],
    currentAmount: number,
    targetAmount: number,
): string | null {
    if (currentAmount >= targetAmount) return 'Goal reached!';
    if (contributions.length === 0) return null;

    // Group total contributed by calendar month.
    const monthlyTotals = new Map<string, number>();
    for (const contribution of contributions) {
        const monthKey = contribution.contributed_at.slice(0, 7); // "YYYY-MM"
        monthlyTotals.set(
            monthKey,
            (monthlyTotals.get(monthKey) ?? 0) + contribution.amount,
        );
    }

    const activeMonths = monthlyTotals.size;
    if (activeMonths === 0) return null;

    const totalContributed = contributions.reduce(
        (sum, c) => sum + c.amount,
        0,
    );
    const averageMonthly = totalContributed / activeMonths;
    if (averageMonthly <= 0) return null;

    const remaining = targetAmount - currentAmount;
    const monthsNeeded = remaining / averageMonthly;
    const projectedDate = new Date();
    projectedDate.setMonth(projectedDate.getMonth() + Math.ceil(monthsNeeded));

    return projectedDate.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
    });
}

function computeAverageMonthly(contributions: SavingsContribution[]): number {
    if (contributions.length === 0) return 0;
    const monthlyTotals = new Map<string, number>();
    for (const c of contributions) {
        const monthKey = c.contributed_at.slice(0, 7);
        monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + c.amount);
    }
    if (monthlyTotals.size === 0) return 0;
    const total = contributions.reduce((sum, c) => sum + c.amount, 0);
    return total / monthlyTotals.size;
}

function formatDate(dateString: string): string {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

// ── Sub-components ────────────────────────────────────────────────────────

function GoalProgressHeader({
    goal,
    colors,
    formatAmount,
}: {
    goal: SavingsGoal;
    colors: ReturnType<typeof useColors>;
    formatAmount: (amount: number, currency: string) => string;
}) {
    const rawPct = Math.min(
        (goal.current_amount / Math.max(goal.target_amount, 1)) * 100,
        100,
    );
    const progress = useSharedValue(0);

    useEffect(() => {
        progress.value = withTiming(rawPct / 100, {duration: 700});
    }, [rawPct, progress]);

    const animStyle = useAnimatedStyle(() => ({
        width: `${progress.value * 100}%` as any,
    }));

    return (
        <View
            style={[
                styles.goalCard,
                {backgroundColor: colors.card, borderColor: colors.border},
            ]}>
            <View style={styles.goalNameRow}>
                <View style={[styles.colorBadge, {backgroundColor: goal.color}]} />
                <Text
                    style={[styles.goalName, {color: colors.foreground}]}
                    numberOfLines={1}>
                    {goal.name}
                </Text>
                {goal.deadline && (
                    <Text style={[styles.deadlineLabel, {color: colors.mutedForeground}]}>
                        {Math.max(
                            0,
                            Math.ceil(
                                (new Date(goal.deadline).getTime() - Date.now()) / 86400000,
                            ),
                        )}
                        d left
                    </Text>
                )}
            </View>

            <View style={styles.amountRow}>
                <Text style={[styles.currentAmount, {color: goal.color}]}>
                    {formatAmount(goal.current_amount, goal.currency)}
                </Text>
                <Text style={[styles.targetAmount, {color: colors.mutedForeground}]}>
                    {' '}/ {formatAmount(goal.target_amount, goal.currency)}
                </Text>
            </View>

            <View style={[styles.progressTrack, {backgroundColor: colors.muted}]}>
                <Animated.View
                    style={[
                        styles.progressFill,
                        animStyle,
                        {backgroundColor: goal.color},
                    ]}
                />
            </View>

            <Text style={[styles.pctLabel, {color: colors.mutedForeground}]}>
                {Math.round(rawPct)}% complete
            </Text>
        </View>
    );
}

function StatsRow({
    contributions,
    goal,
    colors,
    formatAmount,
}: {
    contributions: SavingsContribution[];
    goal: SavingsGoal;
    colors: ReturnType<typeof useColors>;
    formatAmount: (amount: number, currency: string) => string;
}) {
    const avgMonthly = computeAverageMonthly(contributions);
    const projected = computeProjectedCompletion(
        contributions,
        goal.current_amount,
        goal.target_amount,
    );

    return (
        <View
            style={[
                styles.statsRow,
                {backgroundColor: colors.card, borderColor: colors.border},
            ]}>
            <View style={styles.statItem}>
                <Text style={[styles.statValue, {color: colors.foreground}]}>
                    {contributions.length}
                </Text>
                <Text style={[styles.statLabel, {color: colors.mutedForeground}]}>
                    Deposits
                </Text>
            </View>

            <View style={[styles.statDivider, {backgroundColor: colors.border}]} />

            <View style={styles.statItem}>
                <Text
                    style={[styles.statValue, {color: colors.foreground}]}
                    numberOfLines={1}
                    adjustsFontSizeToFit>
                    {avgMonthly > 0
                        ? formatAmount(avgMonthly, goal.currency)
                        : '—'}
                </Text>
                <Text style={[styles.statLabel, {color: colors.mutedForeground}]}>
                    Avg / month
                </Text>
            </View>

            <View style={[styles.statDivider, {backgroundColor: colors.border}]} />

            <View style={styles.statItem}>
                <Text
                    style={[styles.statValue, {color: colors.foreground}]}
                    numberOfLines={1}
                    adjustsFontSizeToFit>
                    {projected ?? '—'}
                </Text>
                <Text style={[styles.statLabel, {color: colors.mutedForeground}]}>
                    Est. done
                </Text>
            </View>
        </View>
    );
}

function ContributionRow({
    item,
    goalColor,
    colors,
    formatAmount,
    currency,
}: {
    item: SavingsContribution;
    goalColor: string;
    colors: ReturnType<typeof useColors>;
    formatAmount: (amount: number, currency: string) => string;
    currency: string;
}) {
    return (
        <View
            style={[
                styles.contributionRow,
                {backgroundColor: colors.card, borderColor: colors.border},
            ]}>
            <View style={[styles.timelineDot, {backgroundColor: goalColor}]} />
            <View style={styles.contributionBody}>
                <Text style={[styles.contributionDate, {color: colors.mutedForeground}]}>
                    {formatDate(item.contributed_at)}
                </Text>
                {item.note ? (
                    <Text style={[styles.contributionNote, {color: colors.foreground}]}>
                        {item.note}
                    </Text>
                ) : null}
            </View>
            <Text style={[styles.contributionAmount, {color: goalColor}]}>
                +{formatAmount(item.amount, currency)}
            </Text>
        </View>
    );
}

// ── Main screen ───────────────────────────────────────────────────────────

type GoalHistoryRoute = RouteProp<RootStackParamList, 'GoalHistory'>;

export default function SavingsContributionHistoryScreen() {
    const {session} = useAuth();
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const {formatAmount, primaryCurrency} = useApp();
    const navigation = useNavigation();
    const route = useRoute<GoalHistoryRoute>();
    const {goalId} = route.params;

    const [goal, setGoal] = useState<SavingsGoal | null>(null);
    const [contributions, setContributions] = useState<SavingsContribution[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showModal, setShowModal] = useState(false);

    const [inputAmount, setInputAmount] = useState('');
    const [inputNote, setInputNote] = useState('');
    const [inputDate, setInputDate] = useState(todayIso);
    const [saving, setSaving] = useState(false);

    const userId = session?.user.id ?? '';

    const load = useCallback(
        async (silent = false) => {
            if (!userId) return;
            if (!silent) setLoading(true);
            try {
                const [loadedGoal, loadedContributions] = await Promise.all([
                    getSavingsGoal(goalId, userId),
                    getSavingsContributions(goalId, userId),
                ]);
                setGoal(loadedGoal);
                setContributions(loadedContributions);
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [goalId, userId],
    );

    useEffect(() => {
        load();
    }, [load]);

    const handleRefresh = useCallback(() => {
        setRefreshing(true);
        load(true);
    }, [load]);

    const resetModal = () => {
        setInputAmount('');
        setInputNote('');
        setInputDate(todayIso());
    };

    const handleAddContribution = async () => {
        const parsedAmount = parseFloat(inputAmount.replace(/,/g, ''));
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            Alert.alert('Invalid amount', 'Please enter a positive number.');
            return;
        }

        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!datePattern.test(inputDate.trim())) {
            Alert.alert('Invalid date', 'Use the format YYYY-MM-DD.');
            return;
        }

        setSaving(true);
        try {
            await addSavingsContribution({
                goal_id:        goalId,
                user_id:        userId,
                amount:         parsedAmount,
                note:           inputNote.trim() || undefined,
                contributed_at: inputDate.trim(),
            });
            setShowModal(false);
            resetModal();
            await load(true);
        } catch (addError: any) {
            Alert.alert('Error', addError.message ?? 'Could not save contribution.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={[styles.loadingRoot, {backgroundColor: colors.background}]}>
                <ActivityIndicator color={colors.primary} size="large" />
            </View>
        );
    }

    if (!goal) {
        return (
            <View style={[styles.loadingRoot, {backgroundColor: colors.background}]}>
                <Text style={[styles.errorText, {color: colors.mutedForeground}]}>
                    Goal not found.
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.root, {backgroundColor: colors.background}]}>
            {/* ── Header bar ── */}
            <View
                style={[
                    styles.header,
                    {paddingTop: insets.top + 12, borderBottomColor: colors.border},
                ]}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                    <Icon name="arrow-back" size={24} color={colors.foreground} />
                </TouchableOpacity>
                <Text
                    style={[styles.headerTitle, {color: colors.foreground}]}
                    numberOfLines={1}>
                    Contributions
                </Text>
                <TouchableOpacity
                    onPress={() => setShowModal(true)}
                    hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                    <Icon
                        name="add-circle-outline"
                        size={26}
                        color={colors.primary}
                    />
                </TouchableOpacity>
            </View>

            {/* ── List ── */}
            <FlatList
                data={contributions}
                keyExtractor={item => item.id}
                contentContainerStyle={[
                    styles.listContent,
                    {paddingBottom: insets.bottom + 100},
                ]}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={colors.primary}
                    />
                }
                ListHeaderComponent={
                    <>
                        <GoalProgressHeader
                            goal={goal}
                            colors={colors}
                            formatAmount={formatAmount}
                        />
                        <StatsRow
                            contributions={contributions}
                            goal={goal}
                            colors={colors}
                            formatAmount={formatAmount}
                        />
                        {contributions.length > 0 && (
                            <Text
                                style={[
                                    styles.timelineHeading,
                                    {color: colors.mutedForeground},
                                ]}>
                                HISTORY
                            </Text>
                        )}
                    </>
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Icon
                            name="wallet-outline"
                            size={44}
                            color={colors.mutedForeground}
                        />
                        <Text
                            style={[styles.emptyText, {color: colors.mutedForeground}]}>
                            No contributions yet
                        </Text>
                        <Text
                            style={[
                                styles.emptySubtext,
                                {color: colors.mutedForeground},
                            ]}>
                            Tap + to record your first deposit.
                        </Text>
                    </View>
                }
                renderItem={({item}) => (
                    <ContributionRow
                        item={item}
                        goalColor={goal.color}
                        colors={colors}
                        formatAmount={formatAmount}
                        currency={goal.currency}
                    />
                )}
            />

            {/* ── Floating add button ── */}
            <TouchableOpacity
                style={[styles.fab, {backgroundColor: colors.primary, bottom: insets.bottom + 24}]}
                onPress={() => setShowModal(true)}
                activeOpacity={0.85}>
                <Icon name="add" size={28} color="#fff" />
            </TouchableOpacity>

            {/* ── Add Contribution modal ── */}
            <Modal
                visible={showModal}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => {
                    if (!saving) {
                        setShowModal(false);
                        resetModal();
                    }
                }}>
                <View
                    style={[
                        styles.modalRoot,
                        {backgroundColor: colors.background},
                    ]}>
                    <View
                        style={[
                            styles.modalHeader,
                            {borderBottomColor: colors.border},
                        ]}>
                        <Text
                            style={[styles.modalTitle, {color: colors.foreground}]}>
                            Add Contribution
                        </Text>
                        <TouchableOpacity
                            onPress={() => {
                                if (!saving) {
                                    setShowModal(false);
                                    resetModal();
                                }
                            }}
                            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                            <Icon
                                name="close"
                                size={24}
                                color={colors.foreground}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.modalBody}>
                        <Text
                            style={[styles.inputLabel, {color: colors.mutedForeground}]}>
                            Amount ({goal.currency})
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
                            placeholder="50,000"
                            placeholderTextColor={colors.mutedForeground}
                            keyboardType="decimal-pad"
                            value={inputAmount}
                            onChangeText={setInputAmount}
                            autoFocus
                        />

                        <Text
                            style={[styles.inputLabel, {color: colors.mutedForeground}]}>
                            Date (YYYY-MM-DD)
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
                            placeholder={todayIso()}
                            placeholderTextColor={colors.mutedForeground}
                            value={inputDate}
                            onChangeText={setInputDate}
                        />

                        <Text
                            style={[styles.inputLabel, {color: colors.mutedForeground}]}>
                            Note (optional)
                        </Text>
                        <TextInput
                            style={[
                                styles.input,
                                styles.noteInput,
                                {
                                    backgroundColor: colors.input,
                                    borderColor: colors.border,
                                    color: colors.foreground,
                                },
                            ]}
                            placeholder="e.g. Monthly salary top-up"
                            placeholderTextColor={colors.mutedForeground}
                            value={inputNote}
                            onChangeText={setInputNote}
                            multiline
                            numberOfLines={2}
                        />

                        <TouchableOpacity
                            style={[
                                styles.saveButton,
                                {
                                    backgroundColor: colors.primary,
                                    opacity: saving ? 0.7 : 1,
                                },
                            ]}
                            onPress={handleAddContribution}
                            disabled={saving}>
                            {saving ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={styles.saveButtonText}>
                                    Save Contribution
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    root: {flex: 1},
    loadingRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    errorText: {fontSize: 15, fontWeight: '500'},

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 14,
        gap: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerTitle: {flex: 1, fontSize: 18, fontWeight: '700'},

    listContent: {padding: 16, gap: 10},

    goalCard: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        marginBottom: 2,
    },
    goalNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
    },
    colorBadge: {width: 12, height: 12, borderRadius: 6},
    goalName: {flex: 1, fontSize: 16, fontWeight: '700'},
    deadlineLabel: {fontSize: 11, fontWeight: '400'},
    amountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 12,
    },
    currentAmount: {fontSize: 24, fontWeight: '800'},
    targetAmount: {fontSize: 13, fontWeight: '400'},
    progressTrack: {height: 8, borderRadius: 4, overflow: 'hidden'},
    progressFill: {height: 8, borderRadius: 4},
    pctLabel: {fontSize: 11, fontWeight: '400', marginTop: 6},

    statsRow: {
        flexDirection: 'row',
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
        marginBottom: 2,
    },
    statItem: {flex: 1, alignItems: 'center', gap: 4},
    statValue: {fontSize: 14, fontWeight: '700', textAlign: 'center'},
    statLabel: {fontSize: 10, fontWeight: '500', textAlign: 'center'},
    statDivider: {width: StyleSheet.hairlineWidth, marginHorizontal: 4},

    timelineHeading: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.8,
        marginTop: 8,
        marginBottom: 4,
    },

    contributionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    timelineDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        flexShrink: 0,
    },
    contributionBody: {flex: 1, gap: 2},
    contributionDate: {fontSize: 12, fontWeight: '400'},
    contributionNote: {fontSize: 13, fontWeight: '500'},
    contributionAmount: {fontSize: 15, fontWeight: '700', flexShrink: 0},

    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
        gap: 8,
    },
    emptyText: {fontSize: 16, fontWeight: '600'},
    emptySubtext: {fontSize: 13, fontWeight: '400', textAlign: 'center'},

    fab: {
        position: 'absolute',
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 4},
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 6,
    },

    modalRoot: {flex: 1},
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modalTitle: {fontSize: 18, fontWeight: '700'},
    modalBody: {padding: 20, gap: 4},
    inputLabel: {
        fontSize: 11,
        fontWeight: '600',
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
    noteInput: {
        height: 72,
        paddingTop: 12,
        textAlignVertical: 'top',
    },
    saveButton: {
        height: 50,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 24,
    },
    saveButtonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
