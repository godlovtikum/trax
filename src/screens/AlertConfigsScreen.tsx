// Smart Alerts configuration screen.
//
// Displays 11 per-type alert cards grouped into five categories.
// Each card has an enable toggle and, when enabled, an expandable
// config panel with the settings relevant to that alert type.
// Changes are auto-saved to SQLite + server 800 ms after the last edit.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {
  getAlertConfigs,
  upsertAlertConfig,
} from '../lib/database';
import type {AlertConfig, NotificationAlertType} from '../types';

// ── Alert-type metadata ───────────────────────────────────────────────────────

type AlertCategory = 'Spending' | 'Budgets' | 'Savings' | 'Investments' | 'Income';

interface AlertMeta {
  type: NotificationAlertType;
  category: AlertCategory;
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  /** Fields shown in the config panel when the alert is enabled. */
  configFields: Array<
    | 'threshold_amount'
    | 'threshold_percent'
    | 'threshold_days'
    | 'days_before'
    | 'payday'
    | 'time'
    | 'day_of_week'
    | 'day_of_month'
  >;
  defaultThreshold?: number;
  defaultDayOfWeek?: number;
  defaultDayOfMonth?: number;
  defaultTime?: string;
}

const ALERT_DEFINITIONS: AlertMeta[] = [
  // ── Spending ──
  {
    type: 'A1',
    category: 'Spending',
    icon: 'alert-circle-outline',
    iconColor: '#EF4444',
    title: 'Large expense alert',
    description: 'Notifies you instantly when a single expense exceeds your threshold.',
    configFields: ['threshold_amount'],
    defaultThreshold: 50000,
  },
  {
    type: 'A3',
    category: 'Spending',
    icon: 'stats-chart-outline',
    iconColor: '#1A56DB',
    title: 'Weekly spending digest',
    description: 'A summary of last week\'s total spending vs. your 30-day average.',
    configFields: ['day_of_week', 'time'],
    defaultDayOfWeek: 1,
    defaultTime: '08:00',
  },
  {
    type: 'A6',
    category: 'Spending',
    icon: 'repeat-outline',
    iconColor: '#F59E0B',
    title: 'Recurring expense reminder',
    description: 'Reminds you N days before a known recurring payment (rent, subscriptions, etc.).',
    configFields: ['payday', 'days_before', 'time'],
    defaultDayOfMonth: 1,
    defaultThreshold: 2,
    defaultTime: '08:00',
  },
  // ── Budgets ──
  {
    type: 'B4',
    category: 'Budgets',
    icon: 'pie-chart-outline',
    iconColor: '#F59E0B',
    title: 'Custom budget threshold',
    description: 'Fires when any budget\'s usage crosses your chosen percentage.',
    configFields: ['threshold_percent'],
    defaultThreshold: 80,
  },
  {
    type: 'B5',
    category: 'Budgets',
    icon: 'refresh-outline',
    iconColor: '#10B981',
    title: 'Budget reset reminder',
    description: 'Notifies you on the 1st of each month when all budgets reset.',
    configFields: ['time'],
    defaultTime: '08:00',
  },
  {
    type: 'B6',
    category: 'Budgets',
    icon: 'trending-down-outline',
    iconColor: '#6366F1',
    title: 'Underused budget check',
    description: 'Alerts you mid-month if any budget is under the threshold % spent.',
    configFields: ['threshold_percent', 'day_of_month', 'time'],
    defaultThreshold: 20,
    defaultDayOfMonth: 20,
    defaultTime: '09:00',
  },
  // ── Savings ──
  {
    type: 'C4',
    category: 'Savings',
    icon: 'wallet-outline',
    iconColor: '#10B981',
    title: 'Missed contribution',
    description: 'Alerts you when no contribution to any savings goal has been recorded in N days.',
    configFields: ['threshold_days'],
    defaultThreshold: 7,
  },
  {
    type: 'C5',
    category: 'Savings',
    icon: 'trending-up-outline',
    iconColor: '#10B981',
    title: 'Weekly savings summary',
    description: 'Weekly progress report for each savings goal — amount saved vs. target.',
    configFields: ['day_of_week', 'time'],
    defaultDayOfWeek: 1,
    defaultTime: '08:00',
  },
  // ── Investments ──
  {
    type: 'D3',
    category: 'Investments',
    icon: 'calendar-outline',
    iconColor: '#6366F1',
    title: 'Investment anniversary',
    description: 'Marks the anniversary of your first investment entry with a review prompt.',
    configFields: ['time'],
    defaultTime: '09:00',
  },
  // ── Income ──
  {
    type: 'E2',
    category: 'Income',
    icon: 'cash-outline',
    iconColor: '#1A56DB',
    title: 'Expected income not logged',
    description: 'Nudges you on payday if you haven\'t recorded any income for the day.',
    configFields: ['payday', 'time'],
    defaultDayOfMonth: 25,
    defaultTime: '10:00',
  },
  {
    type: 'E3',
    category: 'Income',
    icon: 'warning-outline',
    iconColor: '#EF4444',
    title: 'Expenses exceed income',
    description: 'Daily check — alerts you when this month\'s total expenses exceed income.',
    configFields: ['time'],
    defaultTime: '20:00',
  },
];

const CATEGORIES: AlertCategory[] = [
  'Spending', 'Budgets', 'Savings', 'Investments', 'Income',
];

// ── Default config factory ───────────────────────────────────────────────────

function defaultConfig(
  userId: string,
  meta: AlertMeta,
): Omit<AlertConfig, 'id' | 'created_at'> {
  return {
    user_id:           userId,
    alert_type:        meta.type,
    enabled:           false,
    notification_time: meta.defaultTime ?? '08:00',
    day_of_week:       meta.defaultDayOfWeek,
    day_of_month:      meta.defaultDayOfMonth,
    threshold_value:   meta.defaultThreshold,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({title, colors}: {title: string; colors: ReturnType<typeof useColors>}) {
  return (
    <Text style={[styles.sectionHeader, {color: colors.mutedForeground}]}>
      {title.toUpperCase()}
    </Text>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  colors,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.configRow}>
      <Text style={[styles.configLabel, {color: colors.mutedForeground}]}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={[styles.stepBtn, {borderColor: colors.border, backgroundColor: colors.card}]}
          onPress={() => onChange(Math.max(min, value - step))}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="remove" size={16} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.stepValue, {color: colors.foreground}]}>
          {value}{unit ? ` ${unit}` : ''}
        </Text>
        <TouchableOpacity
          style={[styles.stepBtn, {borderColor: colors.border, backgroundColor: colors.card}]}
          onPress={() => onChange(Math.min(max, value + step))}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="add" size={16} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TimePicker({
  value,
  onChange,
  colors,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [hour, minute] = value.split(':').map(Number);

  function adjustHour(delta: number) {
    const newHour = (hour + delta + 24) % 24;
    onChange(`${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  function adjustMinute(delta: number) {
    const newMinute = (minute + delta * 15 + 60) % 60;
    onChange(`${String(hour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}`);
  }

  return (
    <View style={styles.configRow}>
      <Text style={[styles.configLabel, {color: colors.mutedForeground}]}>Delivery time</Text>
      <View style={styles.timeRow}>
        {/* Hour */}
        <TouchableOpacity
          style={[styles.stepBtn, {borderColor: colors.border, backgroundColor: colors.card}]}
          onPress={() => adjustHour(-1)}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="chevron-up" size={14} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.timeSegment, {color: colors.foreground, borderColor: colors.border}]}>
          {String(hour).padStart(2, '0')}
        </Text>
        <TouchableOpacity
          style={[styles.stepBtn, {borderColor: colors.border, backgroundColor: colors.card}]}
          onPress={() => adjustHour(1)}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="chevron-down" size={14} color={colors.foreground} />
        </TouchableOpacity>

        <Text style={[styles.timeColon, {color: colors.mutedForeground}]}>:</Text>

        {/* Minute (15-min increments) */}
        <TouchableOpacity
          style={[styles.stepBtn, {borderColor: colors.border, backgroundColor: colors.card}]}
          onPress={() => adjustMinute(-1)}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="chevron-up" size={14} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.timeSegment, {color: colors.foreground, borderColor: colors.border}]}>
          {String(minute).padStart(2, '0')}
        </Text>
        <TouchableOpacity
          style={[styles.stepBtn, {borderColor: colors.border, backgroundColor: colors.card}]}
          onPress={() => adjustMinute(1)}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="chevron-down" size={14} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function DayOfWeekPicker({
  value,
  onChange,
  colors,
}: {
  value: number;
  onChange: (v: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.configRow}>
      <Text style={[styles.configLabel, {color: colors.mutedForeground}]}>Day of week</Text>
      <View style={styles.dayRow}>
        {DAY_LABELS.map((label, index) => {
          const isSelected = index === value;
          return (
            <TouchableOpacity
              key={label}
              style={[
                styles.dayChip,
                {
                  backgroundColor: isSelected ? colors.primary : colors.card,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => onChange(index)}>
              <Text
                style={[
                  styles.dayChipText,
                  {color: isSelected ? '#fff' : colors.mutedForeground},
                ]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({
  meta,
  config,
  onToggle,
  onUpdate,
  colors,
}: {
  meta: AlertMeta;
  config: Omit<AlertConfig, 'id' | 'created_at'>;
  onToggle: (enabled: boolean) => void;
  onUpdate: (partial: Partial<Omit<AlertConfig, 'id' | 'created_at' | 'alert_type' | 'user_id'>>) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const {configFields} = meta;

  return (
    <View
      style={[
        styles.alertCard,
        {backgroundColor: colors.card, borderColor: colors.border},
      ]}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconBadge,
            {backgroundColor: meta.iconColor + '1A'},
          ]}>
          <Icon name={meta.icon as any} size={20} color={meta.iconColor} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, {color: colors.foreground}]}>{meta.title}</Text>
          <Text style={[styles.cardDesc, {color: colors.mutedForeground}]}>{meta.description}</Text>
        </View>
        <Switch
          value={config.enabled}
          onValueChange={onToggle}
          trackColor={{false: colors.border, true: colors.primary + '80'}}
          thumbColor={config.enabled ? colors.primary : colors.card}
        />
      </View>

      {/* Config panel (visible when enabled) */}
      {config.enabled && (
        <View style={[styles.configPanel, {borderTopColor: colors.border}]}>

          {configFields.includes('threshold_amount') && (
            <View style={styles.configRow}>
              <Text style={[styles.configLabel, {color: colors.mutedForeground}]}>
                Alert when expense exceeds
              </Text>
              <View style={[styles.amountRow, {borderColor: colors.border, backgroundColor: colors.background}]}>
                <TextInput
                  style={[styles.amountInput, {color: colors.foreground}]}
                  value={String(Math.round(config.threshold_value ?? 50000))}
                  onChangeText={text => {
                    const parsed = parseInt(text.replace(/\D/g, ''), 10);
                    if (!isNaN(parsed)) onUpdate({threshold_value: parsed});
                  }}
                  keyboardType="numeric"
                  selectTextOnFocus
                />
                <Text style={[styles.amountUnit, {color: colors.mutedForeground}]}>XAF</Text>
              </View>
            </View>
          )}

          {configFields.includes('threshold_percent') && (
            <Stepper
              label={
                meta.type === 'B6'
                  ? 'Alert if budget usage is below'
                  : 'Alert when usage reaches'
              }
              value={Math.round(config.threshold_value ?? meta.defaultThreshold ?? 80)}
              min={meta.type === 'B6' ? 5 : 50}
              max={meta.type === 'B6' ? 50 : 95}
              step={5}
              unit="%"
              onChange={v => onUpdate({threshold_value: v})}
              colors={colors}
            />
          )}

          {configFields.includes('threshold_days') && (
            <Stepper
              label="Alert after no contribution for"
              value={Math.round(config.threshold_value ?? 7)}
              min={1}
              max={30}
              unit={config.threshold_value === 1 ? 'day' : 'days'}
              onChange={v => onUpdate({threshold_value: v})}
              colors={colors}
            />
          )}

          {configFields.includes('days_before') && (
            <Stepper
              label="Days before payday to remind me"
              value={Math.round(config.threshold_value ?? 2)}
              min={1}
              max={7}
              unit={config.threshold_value === 1 ? 'day' : 'days'}
              onChange={v => onUpdate({threshold_value: v})}
              colors={colors}
            />
          )}

          {configFields.includes('payday') && (
            <Stepper
              label={meta.type === 'A6' ? 'Recurring payment day of month' : 'Payday (day of month)'}
              value={config.day_of_month ?? meta.defaultDayOfMonth ?? 25}
              min={1}
              max={28}
              onChange={v => onUpdate({day_of_month: v})}
              colors={colors}
            />
          )}

          {configFields.includes('day_of_month') && (
            <Stepper
              label="Check on day of month"
              value={config.day_of_month ?? meta.defaultDayOfMonth ?? 20}
              min={1}
              max={28}
              onChange={v => onUpdate({day_of_month: v})}
              colors={colors}
            />
          )}

          {configFields.includes('day_of_week') && (
            <DayOfWeekPicker
              value={config.day_of_week ?? meta.defaultDayOfWeek ?? 1}
              onChange={v => onUpdate({day_of_week: v})}
              colors={colors}
            />
          )}

          {configFields.includes('time') && (
            <TimePicker
              value={config.notification_time ?? meta.defaultTime ?? '08:00'}
              onChange={v => onUpdate({notification_time: v})}
              colors={colors}
            />
          )}
        </View>
      )}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

type ConfigMap = Record<NotificationAlertType, Omit<AlertConfig, 'id' | 'created_at'>>;

function buildDefaultConfigs(userId: string): ConfigMap {
  return Object.fromEntries(
    ALERT_DEFINITIONS.map(meta => [meta.type, defaultConfig(userId, meta)]),
  ) as ConfigMap;
}

export default function AlertConfigsScreen() {
  const {session} = useAuth();
  const colors     = useColors();
  const insets     = useSafeAreaInsets();

  const userId = session?.user?.id ?? '';

  const [configs, setConfigs] = useState<ConfigMap>(buildDefaultConfigs(userId));
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<NotificationAlertType | null>(null);

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Load configs from local DB on mount ───────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    getAlertConfigs(userId)
      .then(savedConfigs => {
        if (savedConfigs.length === 0) return;
        setConfigs(prev => {
          const next = {...prev};
          for (const saved of savedConfigs) {
            const alertType = saved.alert_type as NotificationAlertType;
            next[alertType] = {
              user_id:           userId,
              alert_type:        alertType,
              enabled:           saved.enabled,
              notification_time: saved.notification_time,
              day_of_week:       saved.day_of_week ?? undefined,
              day_of_month:      saved.day_of_month ?? undefined,
              threshold_value:   saved.threshold_value ?? undefined,
            };
          }
          return next;
        });
      })
      .catch(() => {
        // DB may not be seeded yet — silently use defaults
      })
      .finally(() => setLoading(false));
  }, [userId]);

  // ── Debounced save ────────────────────────────────────────────────────────
  const scheduleAutoSave = useCallback(
    (alertType: NotificationAlertType, updatedConfig: Omit<AlertConfig, 'id' | 'created_at'>) => {
      if (saveTimers.current[alertType]) {
        clearTimeout(saveTimers.current[alertType]);
      }
      saveTimers.current[alertType] = setTimeout(async () => {
        setSavingType(alertType);
        try {
          await upsertAlertConfig(updatedConfig);
        } catch {
          Alert.alert('Could not save', 'Your changes could not be saved. Please try again.');
        } finally {
          setSavingType(null);
        }
      }, 800);
    },
    [],
  );

  // ── Toggle enabled ────────────────────────────────────────────────────────
  function handleToggle(alertType: NotificationAlertType, enabled: boolean) {
    setConfigs(prev => {
      const updated = {...prev[alertType], enabled};
      const next    = {...prev, [alertType]: updated};
      scheduleAutoSave(alertType, updated);
      return next;
    });
  }

  // ── Update a field ────────────────────────────────────────────────────────
  function handleUpdate(
    alertType: NotificationAlertType,
    partial: Partial<Omit<AlertConfig, 'id' | 'created_at' | 'alert_type' | 'user_id'>>,
  ) {
    setConfigs(prev => {
      const updated = {...prev[alertType], ...partial};
      const next    = {...prev, [alertType]: updated};
      scheduleAutoSave(alertType, updated);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      {/* Header */}
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={[styles.title, {color: colors.foreground}]}>Smart Alerts</Text>
        <Text style={[styles.subtitle, {color: colors.mutedForeground}]}>
          {ALERT_DEFINITIONS.filter(m => configs[m.type].enabled).length} of{' '}
          {ALERT_DEFINITIONS.length} active
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {paddingBottom: insets.bottom + 24},
          ]}
          showsVerticalScrollIndicator={false}>

          {/* Description banner */}
          <View
            style={[
              styles.infoBanner,
              {backgroundColor: colors.primary + '14', borderColor: colors.primary + '30'},
            ]}>
            <Icon name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={[styles.infoText, {color: colors.primary}]}>
              Contextual alerts (expense, budget, savings) fire automatically when you
              record data. Scheduled alerts use your chosen time and day.
            </Text>
          </View>

          {/* Render each category section */}
          {CATEGORIES.map(category => {
            const alertsInCategory = ALERT_DEFINITIONS.filter(
              meta => meta.category === category,
            );
            return (
              <View key={category}>
                <SectionHeader title={category} colors={colors} />
                {alertsInCategory.map(meta => (
                  <View key={meta.type} style={styles.cardWrapper}>
                    {savingType === meta.type && (
                      <View style={styles.savingBadge}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={[styles.savingText, {color: colors.primary}]}>Saving…</Text>
                      </View>
                    )}
                    <AlertCard
                      meta={meta}
                      config={configs[meta.type]}
                      onToggle={enabled => handleToggle(meta.type, enabled)}
                      onUpdate={partial => handleUpdate(meta.type, partial)}
                      colors={colors}
                    />
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:         {flex: 1},
  header:       {paddingHorizontal: 20, paddingBottom: 8},
  title:        {fontSize: 28, fontWeight: '700', marginBottom: 2},
  subtitle:     {fontSize: 14},
  loadingCenter:{flex: 1, alignItems: 'center', justifyContent: 'center'},
  scroll:       {flex: 1},
  scrollContent:{paddingHorizontal: 16, paddingTop: 12, gap: 4},

  infoBanner: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            10,
    padding:        12,
    borderRadius:   10,
    borderWidth:    1,
    marginBottom:   8,
  },
  infoText: {flex: 1, fontSize: 13, lineHeight: 18},

  sectionHeader: {
    fontSize:      11,
    fontWeight:    '600',
    letterSpacing: 0.8,
    paddingTop:    20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },

  cardWrapper:  {marginBottom: 10, position: 'relative'},
  savingBadge:  {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             6,
    position:        'absolute',
    top:             10,
    right:           52,
    zIndex:          10,
  },
  savingText:   {fontSize: 11, fontWeight: '600'},

  alertCard: {
    borderRadius: 14,
    borderWidth:  1,
    overflow:     'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    padding:       14,
    gap:           12,
  },
  iconBadge: {
    width:         40,
    height:        40,
    borderRadius:  10,
    alignItems:    'center',
    justifyContent:'center',
    flexShrink:    0,
    marginTop:     2,
  },
  cardHeaderText:{flex: 1},
  cardTitle:    {fontSize: 15, fontWeight: '600', marginBottom: 3},
  cardDesc:     {fontSize: 13, lineHeight: 18},

  configPanel: {
    borderTopWidth: 1,
    padding:        14,
    paddingTop:     12,
    gap:            14,
  },
  configRow:    {gap: 8},
  configLabel:  {fontSize: 12, fontWeight: '600', letterSpacing: 0.3},

  // Stepper
  stepperRow:   {flexDirection: 'row', alignItems: 'center', gap: 12},
  stepBtn: {
    width:         34,
    height:        34,
    borderRadius:  8,
    borderWidth:   1,
    alignItems:    'center',
    justifyContent:'center',
  },
  stepValue: {fontSize: 16, fontWeight: '600', minWidth: 60, textAlign: 'center'},

  // Day-of-week picker
  dayRow:       {flexDirection: 'row', gap: 6, flexWrap: 'wrap'},
  dayChip: {
    paddingHorizontal: 8,
    paddingVertical:   6,
    borderRadius:      8,
    borderWidth:       1,
    minWidth:          40,
    alignItems:        'center',
  },
  dayChipText:  {fontSize: 12, fontWeight: '600'},

  // Time picker
  timeRow:      {flexDirection: 'row', alignItems: 'center', gap: 8},
  timeSegment: {
    fontSize:    20,
    fontWeight:  '700',
    width:       44,
    textAlign:   'center',
    borderWidth: 1,
    borderRadius:8,
    paddingVertical: 4,
  },
  timeColon:    {fontSize: 20, fontWeight: '700'},

  // Amount input
  amountRow: {
    flexDirection: 'row',
    alignItems:    'center',
    borderWidth:   1,
    borderRadius:  10,
    paddingHorizontal: 12,
    height:        44,
  },
  amountInput:  {flex: 1, fontSize: 18, fontWeight: '600', paddingVertical: 0},
  amountUnit:   {fontSize: 14, fontWeight: '600', marginLeft: 8},
});
