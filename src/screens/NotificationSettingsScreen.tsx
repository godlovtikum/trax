/**
 * NotificationSettingsScreen
 *
 * Manages four independent notification categories:
 *
 *  1. Transaction Reminders — repeating reminder to log income/expenses.
 *     Configurable frequency (daily/weekly/monthly/custom) + time.
 *
 *  2. Spending Alerts — fires immediately after the user records a single
 *     expense above a configurable threshold. Useful as a sanity-check
 *     for large outflows (e.g. "FCFA 150 000 just recorded — is that right?")
 *
 *  3. Budget Warnings — fires when any active budget's usage crosses 80%.
 *     Delivered in-app when budget data is loaded after an outgoing spend.
 *
 *  4. Savings Progress — weekly summary (Monday) of each goal's progress.
 *
 *  5. Investment Review — monthly reminder (1st of month) to review
 *     portfolio positions.
 *
 * Scheduling uses @notifee/react-native. Channels are created lazily the
 * first time a notification type is enabled. Every schedule is set up
 * before the server upsert so the device and server agree even if the
 * network call fails.
 */
import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import notifee, {
  TriggerType,
  RepeatFrequency,
  AndroidImportance,
  AuthorizationStatus,
} from '@notifee/react-native';
import type {TimestampTrigger, IntervalTrigger} from '@notifee/react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {
  getNotificationSettings,
  upsertNotificationSettings,
} from '../lib/database';
import type {NotificationFrequency, NotificationSettings} from '../types';

// ─── Channel IDs ──────────────────────────────────────────────────────────────

const CHANNEL_REMINDERS   = 'trax-reminders';
const CHANNEL_SPENDING    = 'trax-spending-alerts';
const CHANNEL_BUDGET      = 'trax-budget-alerts';
const CHANNEL_SAVINGS     = 'trax-savings-alerts';
const CHANNEL_INVESTMENTS = 'trax-investment-alerts';

const NOTIF_ID_REMINDER   = 'trax-recurring-reminder';
const NOTIF_ID_SAVINGS    = 'trax-savings-weekly';
const NOTIF_ID_INVESTMENT = 'trax-investment-monthly';

// ─── Frequency options ────────────────────────────────────────────────────────

const REMINDER_FREQUENCIES: {
  value: NotificationFrequency;
  label: string;
  desc:  string;
}[] = [
  {value: 'daily',   label: 'Daily',   desc: 'Every day at your chosen time'},
  {value: 'weekly',  label: 'Weekly',  desc: 'Once a week on your chosen day'},
  {value: 'monthly', label: 'Monthly', desc: 'Once a month on your chosen date'},
  {value: 'custom',  label: 'Custom',  desc: 'Every N days'},
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS        = Array.from({length: 24}, (_, i) => i);
const MINUTES      = [...generateRange(0, 59)];


/**
 * Generate an array of digits 
 *  @param start the first number
 *  @param end: the last number 

 */
const generateRange = (start: number, end: number) => {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

// ─── Scheduling helpers ───────────────────────────────────────────────────────

async function ensureChannel(
  channelId:   string,
  channelName: string,
  importance:  AndroidImportance = AndroidImportance.HIGH,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({id: channelId, name: channelName, importance, sound: 'default'});
}

async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const permissionSettings = await notifee.requestPermission();
  return permissionSettings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

function nextDailyTimestamp(hour: number, minute: number): number {
  const now    = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function nextWeekdayTimestamp(weekday: number, hour: number, minute: number): number {
  const now    = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  const diff = ((weekday - now.getDay()) + 7) % 7;
  target.setDate(now.getDate() + (diff === 0 && target <= now ? 7 : diff));
  return target.getTime();
}

function nextMonthDayTimestamp(dayOfMonth: number, hour: number, minute: number): number {
  const now    = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0, 0);
  if (target <= now) target.setMonth(target.getMonth() + 1);
  return target.getTime();
}

function nextFirstOfMonthTimestamp(hour: number, minute: number): number {
  return nextMonthDayTimestamp(1, hour, minute);
}

function nextMondayTimestamp(hour: number, minute: number): number {
  return nextWeekdayTimestamp(1 /* Monday */, hour, minute);
}

async function cancelNotification(notificationId: string): Promise<void> {
  try {
    await notifee.cancelNotification(notificationId);
    await notifee.cancelTriggerNotification(notificationId);
  } catch {
    // best-effort
  }
}

// ─── Individual schedulers ────────────────────────────────────────────────────

async function scheduleTransactionReminder(settings: {
  enabled:              boolean;
  frequency:            NotificationFrequency;
  notification_time:    string;
  day_of_week?:         number;
  day_of_month?:        number;
  custom_interval_days?: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelNotification(NOTIF_ID_REMINDER);
  if (!settings.enabled) return;

  await ensureChannel(CHANNEL_REMINDERS, 'TraX Reminders');

  const [hourStr, minStr] = settings.notification_time.split(':');
  const reminderHour      = parseInt(hourStr, 10);
  const reminderMinute    = parseInt(minStr, 10);

  const baseNotification: Parameters<typeof notifee.createTriggerNotification>[0] = {
    id:      NOTIF_ID_REMINDER,
    title:   'TraX Reminder',
    body:    "Don't forget to record today's transactions!",
    android: {
      channelId:   CHANNEL_REMINDERS,
      smallIcon:   'ic_stat_trax',
      color:       '#1A56DB',
      pressAction: {id: 'default'},
    },
    ios: {sound: 'default', badgeCount: 1},
  };

  if (settings.frequency === 'daily') {
    const trigger: TimestampTrigger = {
      type:            TriggerType.TIMESTAMP,
      timestamp:       nextDailyTimestamp(reminderHour, reminderMinute),
      repeatFrequency: RepeatFrequency.DAILY,
    };
    await notifee.createTriggerNotification(baseNotification, trigger);
    return;
  }

  if (settings.frequency === 'weekly') {
    const targetWeekday = settings.day_of_week ?? 1;
    const trigger: TimestampTrigger = {
      type:            TriggerType.TIMESTAMP,
      timestamp:       nextWeekdayTimestamp(targetWeekday, reminderHour, reminderMinute),
      repeatFrequency: RepeatFrequency.WEEKLY,
    };
    await notifee.createTriggerNotification(
      {...baseNotification, title: 'TraX Weekly Reminder', body: 'Time to log this week\'s transactions!'},
      trigger,
    );
    return;
  }

  if (settings.frequency === 'monthly') {
    const targetDayOfMonth = settings.day_of_month ?? 1;
    const trigger: TimestampTrigger = {
      type:      TriggerType.TIMESTAMP,
      timestamp: nextMonthDayTimestamp(targetDayOfMonth, reminderHour, reminderMinute),
    };
    await notifee.createTriggerNotification(
      {...baseNotification, title: 'TraX Monthly Reminder', body: 'Review your monthly expenses!'},
      trigger,
    );
    return;
  }

  if (settings.frequency === 'custom') {
    const intervalDays = Math.max(1, settings.custom_interval_days ?? 3);
    const trigger: IntervalTrigger = {
      type:     TriggerType.INTERVAL,
      interval: intervalDays * 24 * 60, // notifee uses minutes
    };
    await notifee.createTriggerNotification(
      {...baseNotification, body: 'Time to log your transactions!'},
      trigger,
    );
    return;
  }
}

async function scheduleSavingsAlerts(
  enabled:          boolean,
  notificationTime: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelNotification(NOTIF_ID_SAVINGS);
  if (!enabled) return;

  await ensureChannel(CHANNEL_SAVINGS, 'TraX Savings Progress', AndroidImportance.DEFAULT);

  const [hourStr, minStr] = notificationTime.split(':');
  const reminderHour      = parseInt(hourStr, 10);
  const reminderMinute    = parseInt(minStr, 10);

  const trigger: TimestampTrigger = {
    type:            TriggerType.TIMESTAMP,
    timestamp:       nextMondayTimestamp(reminderHour, reminderMinute),
    repeatFrequency: RepeatFrequency.WEEKLY,
  };

  await notifee.createTriggerNotification(
    {
      id:      NOTIF_ID_SAVINGS,
      title:   'Savings Check-in',
      body:    'How are your savings goals going this week?',
      android: {
        channelId:   CHANNEL_SAVINGS,
        smallIcon:   'ic_stat_trax',
        color:       '#10B981',
        pressAction: {id: 'default'},
      },
      ios: {sound: 'default'},
    },
    trigger,
  );
}

async function scheduleInvestmentAlerts(
  enabled:          boolean,
  notificationTime: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelNotification(NOTIF_ID_INVESTMENT);
  if (!enabled) return;

  await ensureChannel(CHANNEL_INVESTMENTS, 'TraX Investment Review', AndroidImportance.DEFAULT);

  const [hourStr, minStr] = notificationTime.split(':');
  const reminderHour      = parseInt(hourStr, 10);
  const reminderMinute    = parseInt(minStr, 10);

  const trigger: TimestampTrigger = {
    type:      TriggerType.TIMESTAMP,
    timestamp: nextFirstOfMonthTimestamp(reminderHour, reminderMinute),
  };

  await notifee.createTriggerNotification(
    {
      id:      NOTIF_ID_INVESTMENT,
      title:   'Monthly Investment Review',
      body:    'Time to check in on your investments this month.',
      android: {
        channelId:   CHANNEL_INVESTMENTS,
        smallIcon:   'ic_stat_trax',
        color:       '#6366F1',
        pressAction: {id: 'default'},
      },
      ios: {sound: 'default'},
    },
    trigger,
  );
}

/**
 * Fires a one-shot spending alert immediately. Called from the data
 * layer (database.ts → addTransaction) after a large expense is saved.
 * Exported so database.ts can invoke it without a circular import.
 */
export async function fireSpendingAlert(
  amountValue: number,
  currency:    string,
  categoryName: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ensureChannel(CHANNEL_SPENDING, 'TraX Spending Alerts', AndroidImportance.HIGH);
    await notifee.displayNotification({
      title: 'Large expense recorded',
      body:  `${currency} ${amountValue.toLocaleString()} in ${categoryName} — is that right?`,
      android: {
        channelId:   CHANNEL_SPENDING,
        smallIcon:   'ic_stat_trax',
        color:       '#EF4444',
        pressAction: {id: 'default'},
      },
      ios: {sound: 'default'},
    });
  } catch {
    // Notification is best-effort; never block the UI on it.
  }
}

/**
 * Fires a budget warning alert immediately. Called from the data layer
 * when a budget's usage crosses 80%.
 */
export async function fireBudgetWarning(
  categoryName: string,
  usagePercent: number,
  currency:     string,
  remaining:    number,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ensureChannel(CHANNEL_BUDGET, 'TraX Budget Warnings', AndroidImportance.HIGH);
    await notifee.displayNotification({
      title: `Budget alert — ${categoryName}`,
      body:  `You've used ${Math.round(usagePercent)}% of your budget. Only ${currency} ${remaining.toLocaleString()} left.`,
      android: {
        channelId:   CHANNEL_BUDGET,
        smallIcon:   'ic_stat_trax',
        color:       '#F59E0B',
        pressAction: {id: 'default'},
      },
      ios: {sound: 'default'},
    });
  } catch {
    // best-effort
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const {session} = useAuth();
  const colors    = useColors();
  const insets    = useSafeAreaInsets();
  const navigation = useNavigation();

  // ── Reminder settings (existing) ──────────────────────────────────────
  const [enabled, setEnabled]           = useState(false);
  const [frequency, setFrequency]       = useState<NotificationFrequency>('daily');
  const [hour, setHour]                 = useState(20);
  const [minute, setMinute]             = useState(0);
  const [dayOfWeek, setDayOfWeek]       = useState(1);
  const [dayOfMonth, setDayOfMonth]     = useState(1);
  const [intervalDays, setIntervalDays] = useState('3');

  // ── Alert type settings (new) ─────────────────────────────────────────
  const [spendingAlertsEnabled, setSpendingAlertsEnabled]     = useState(true);
  const [spendingThreshold, setSpendingThreshold]             = useState('50000');
  const [budgetAlertsEnabled, setBudgetAlertsEnabled]         = useState(true);
  const [savingsAlertsEnabled, setSavingsAlertsEnabled]       = useState(false);
  const [investmentAlertsEnabled, setInvestmentAlertsEnabled] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (!session) return;
    getNotificationSettings(session.user.id).then(storedSettings => {
      if (storedSettings) {
        setEnabled(storedSettings.enabled);
        setFrequency(storedSettings.frequency);
        const [parsedHour, parsedMinute] = storedSettings.notification_time.split(':').map(Number);
        setHour(parsedHour);
        setMinute(parsedMinute);
        if (storedSettings.day_of_week   != null) setDayOfWeek(storedSettings.day_of_week);
        if (storedSettings.day_of_month  != null) setDayOfMonth(storedSettings.day_of_month);
        if (storedSettings.custom_interval_days) {
          setIntervalDays(storedSettings.custom_interval_days.toString());
        }
        setSpendingAlertsEnabled(storedSettings.spending_alerts_enabled);
        setSpendingThreshold(String(storedSettings.spending_alert_threshold ?? 50000));
        setBudgetAlertsEnabled(storedSettings.budget_alerts_enabled);
        setSavingsAlertsEnabled(storedSettings.savings_alerts_enabled);
        setInvestmentAlertsEnabled(storedSettings.investment_alerts_enabled);
      }
      setLoading(false);
    });
  }, [session?.user.id]);

  const handleMasterToggle = async (newValue: boolean) => {
    if (newValue && Platform.OS !== 'web') {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Please enable notifications in your device settings to use reminders.',
        );
        return;
      }
    }
    setEnabled(newValue);
  };

  const currentTimeString = useCallback(
    () => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    [hour, minute],
  );

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);

    const notificationTimeString = currentTimeString();
    const parsedIntervalDays     = parseInt(intervalDays, 10) || 3;
    const parsedThreshold        = parseFloat(spendingThreshold) || 50000;

    const settingsPayload: Omit<NotificationSettings, 'id' | 'created_at'> = {
      user_id:                  session.user.id,
      enabled,
      frequency,
      notification_time:        notificationTimeString,
      day_of_week:              frequency === 'weekly'  ? dayOfWeek  : undefined,
      day_of_month:             frequency === 'monthly' ? dayOfMonth : undefined,
      custom_interval_days:     frequency === 'custom'  ? parsedIntervalDays : undefined,
      spending_alerts_enabled:  spendingAlertsEnabled,
      spending_alert_threshold: parsedThreshold,
      budget_alerts_enabled:    budgetAlertsEnabled,
      savings_alerts_enabled:   savingsAlertsEnabled,
      investment_alerts_enabled: investmentAlertsEnabled,
    };

    // Schedule all notifications BEFORE saving to server — if scheduling
    // fails the user needs to know immediately. If the server then fails we
    // roll back the schedule.
    try {
      await Promise.all([
        scheduleTransactionReminder({
          enabled,
          frequency,
          notification_time:    notificationTimeString,
          day_of_week:          settingsPayload.day_of_week,
          day_of_month:         settingsPayload.day_of_month,
          custom_interval_days: settingsPayload.custom_interval_days,
        }),
        scheduleSavingsAlerts(savingsAlertsEnabled, notificationTimeString),
        scheduleInvestmentAlerts(investmentAlertsEnabled, notificationTimeString),
      ]);
    } catch (scheduleError: any) {
      setSaving(false);
      Alert.alert(
        "Couldn't schedule notifications",
        scheduleError?.message ?? 'The system rejected the notification schedule.',
      );
      return;
    }

    try {
      await upsertNotificationSettings(settingsPayload);
      Alert.alert(
        'Settings saved',
        'Your notification preferences have been updated.',
      );
    } catch (saveError: any) {
      // Roll back all schedules so device and server remain consistent.
      try {
        await Promise.all([
          cancelNotification(NOTIF_ID_REMINDER),
          cancelNotification(NOTIF_ID_SAVINGS),
          cancelNotification(NOTIF_ID_INVESTMENT),
        ]);
      } catch {
        // best-effort
      }
      Alert.alert(
        "Couldn't save",
        saveError?.message ?? 'Failed to save notification settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, {backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center'}]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      {/* ── Header ── */}
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, {color: colors.foreground}]}>Notifications</Text>
        <View style={{width: 24}} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, {paddingBottom: insets.bottom + 40}]}>

        {/* ══ Section 1: Transaction Reminders ══ */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground}]}>
          Transaction Reminders
        </Text>
        <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, {backgroundColor: colors.primary + '15'}]}>
              <Icon name="notifications-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, {color: colors.foreground}]}>
                Daily reminder
              </Text>
              <Text style={[styles.cardSub, {color: colors.mutedForeground}]}>
                Get notified to log your income &amp; expenses
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={handleMasterToggle}
              trackColor={{false: colors.muted, true: colors.primary + '80'}}
              thumbColor={enabled ? colors.primary : colors.mutedForeground}
            />
          </View>
        </View>

        {enabled && (
          <>
            {/* Frequency */}
            <Text style={[styles.subLabel, {color: colors.mutedForeground}]}>Frequency</Text>
            <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
              {REMINDER_FREQUENCIES.map((freqOption, freqIndex) => (
                <TouchableOpacity
                  key={freqOption.value}
                  style={[
                    styles.freqRow,
                    freqIndex > 0 && {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
                  ]}
                  onPress={() => setFrequency(freqOption.value)}>
                  <View style={styles.freqInfo}>
                    <Text style={[styles.freqLabel, {color: colors.foreground}]}>{freqOption.label}</Text>
                    <Text style={[styles.freqDesc,  {color: colors.mutedForeground}]}>{freqOption.desc}</Text>
                  </View>
                  <View style={[styles.radio, {borderColor: frequency === freqOption.value ? colors.primary : colors.border}]}>
                    {frequency === freqOption.value && (
                      <View style={[styles.radioDot, {backgroundColor: colors.primary}]} />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Time picker */}
            <Text style={[styles.subLabel, {color: colors.mutedForeground}]}>Reminder Time</Text>
            <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
              <View style={styles.timeRow}>
                {/* Hour column */}
                <View style={styles.timePickerCol}>
                  <Text style={[styles.timeLabel, {color: colors.mutedForeground}]}>Hour</Text>
                  <ScrollView style={styles.timePicker} showsVerticalScrollIndicator={false}>
                    {HOURS.map(hourOption => (
                      <TouchableOpacity
                        key={hourOption}
                        style={[styles.timeItem, hour === hourOption && {backgroundColor: colors.primary}]}
                        onPress={() => setHour(hourOption)}>
                        <Text style={[styles.timeItemText, {color: hour === hourOption ? '#fff' : colors.foreground}]}>
                          {String(hourOption).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <Text style={[styles.timeSep, {color: colors.foreground}]}>:</Text>

                {/* Minute column */}
                <View style={styles.timePickerCol}>
                  <Text style={[styles.timeLabel, {color: colors.mutedForeground}]}>Min</Text>
                  <ScrollView style={styles.timePicker} showsVerticalScrollIndicator={false}>
                    {MINUTES.map(minuteOption => (
                      <TouchableOpacity
                        key={minuteOption}
                        style={[styles.timeItem, minute === minuteOption && {backgroundColor: colors.primary}]}
                        onPress={() => setMinute(minuteOption)}>
                        <Text style={[styles.timeItemText, {color: minute === minuteOption ? '#fff' : colors.foreground}]}>
                          {String(minuteOption).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Live display */}
                <View style={styles.timeDisplay}>
                  <Text style={[styles.timeDisplayText, {color: colors.primary}]}>
                    {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
                  </Text>
                  <Text style={[styles.timeDisplayLabel, {color: colors.mutedForeground}]}>
                    {hour < 12 ? 'AM' : 'PM'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Weekly: day of week */}
            {frequency === 'weekly' && (
              <>
                <Text style={[styles.subLabel, {color: colors.mutedForeground}]}>Day of Week</Text>
                <View style={styles.dayRow}>
                  {DAYS_OF_WEEK.map((dayName, dayIndex) => (
                    <TouchableOpacity
                      key={dayIndex}
                      style={[
                        styles.dayBtn,
                        {
                          backgroundColor: dayOfWeek === dayIndex ? colors.primary : colors.card,
                          borderColor:     dayOfWeek === dayIndex ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setDayOfWeek(dayIndex)}>
                      <Text style={[styles.dayText, {color: dayOfWeek === dayIndex ? '#fff' : colors.foreground}]}>
                        {dayName}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Monthly: day of month */}
            {frequency === 'monthly' && (
              <>
                <Text style={[styles.subLabel, {color: colors.mutedForeground}]}>Day of Month</Text>
                <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity onPress={() => setDayOfMonth(d => Math.max(1, d - 1))}>
                      <Icon name="remove" size={24} color={colors.primary} />
                    </TouchableOpacity>
                    <Text style={[styles.stepperValue, {color: colors.foreground}]}>{dayOfMonth}</Text>
                    <TouchableOpacity onPress={() => setDayOfMonth(d => Math.min(28, d + 1))}>
                      <Icon name="add" size={24} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            {/* Custom: every N days */}
            {frequency === 'custom' && (
              <>
                <Text style={[styles.subLabel, {color: colors.mutedForeground}]}>Every N Days</Text>
                <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
                  <View style={styles.customRow}>
                    <Text style={[styles.customLabel, {color: colors.foreground}]}>Every</Text>
                    <TextInput
                      style={[styles.customInput, {backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground}]}
                      value={intervalDays}
                      onChangeText={setIntervalDays}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    <Text style={[styles.customLabel, {color: colors.foreground}]}>days</Text>
                  </View>
                </View>
              </>
            )}
          </>
        )}

        {/* ══ Section 2: Spending Alerts ══ */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground, marginTop: 24}]}>
          Spending Alerts
        </Text>
        <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, {backgroundColor: '#EF444415'}]}>
              <Icon name="alert-circle-outline" size={20} color="#EF4444" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, {color: colors.foreground}]}>
                Large expense alert
              </Text>
              <Text style={[styles.cardSub, {color: colors.mutedForeground}]}>
                Notifies you instantly after a big spend
              </Text>
            </View>
            <Switch
              value={spendingAlertsEnabled}
              onValueChange={setSpendingAlertsEnabled}
              trackColor={{false: colors.muted, true: '#EF444480'}}
              thumbColor={spendingAlertsEnabled ? '#EF4444' : colors.mutedForeground}
            />
          </View>
          {spendingAlertsEnabled && (
            <View style={[styles.thresholdRow, {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border}]}>
              <Text style={[styles.thresholdLabel, {color: colors.foreground}]}>
                Alert threshold
              </Text>
              <View style={[styles.thresholdInput, {backgroundColor: colors.input, borderColor: colors.border}]}>
                <TextInput
                  style={[styles.thresholdText, {color: colors.foreground}]}
                  value={spendingThreshold}
                  onChangeText={setSpendingThreshold}
                  keyboardType="numeric"
                  maxLength={10}
                />
              </View>
              <Text style={[styles.thresholdCurrency, {color: colors.mutedForeground}]}>FCFA</Text>
            </View>
          )}
        </View>

        {/* ══ Section 3: Budget Warnings ══ */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground, marginTop: 24}]}>
          Budget Warnings
        </Text>
        <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, {backgroundColor: '#F59E0B15'}]}>
              <Icon name="pie-chart-outline" size={20} color="#F59E0B" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, {color: colors.foreground}]}>
                Budget limit warning
              </Text>
              <Text style={[styles.cardSub, {color: colors.mutedForeground}]}>
                Alert when any budget reaches 80% usage
              </Text>
            </View>
            <Switch
              value={budgetAlertsEnabled}
              onValueChange={setBudgetAlertsEnabled}
              trackColor={{false: colors.muted, true: '#F59E0B80'}}
              thumbColor={budgetAlertsEnabled ? '#F59E0B' : colors.mutedForeground}
            />
          </View>
        </View>

        {/* ══ Section 4: Savings Progress ══ */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground, marginTop: 24}]}>
          Savings Progress
        </Text>
        <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, {backgroundColor: '#10B98115'}]}>
              <Icon name="trending-up-outline" size={20} color="#10B981" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, {color: colors.foreground}]}>
                Weekly savings update
              </Text>
              <Text style={[styles.cardSub, {color: colors.mutedForeground}]}>
                Every Monday — how your goals are tracking
              </Text>
            </View>
            <Switch
              value={savingsAlertsEnabled}
              onValueChange={setSavingsAlertsEnabled}
              trackColor={{false: colors.muted, true: '#10B98180'}}
              thumbColor={savingsAlertsEnabled ? '#10B981' : colors.mutedForeground}
            />
          </View>
        </View>

        {/* ══ Section 5: Investment Review ══ */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground, marginTop: 24}]}>
          Investment Review
        </Text>
        <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, {backgroundColor: '#6366F115'}]}>
              <Icon name="bar-chart-outline" size={20} color="#6366F1" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, {color: colors.foreground}]}>
                Monthly portfolio reminder
              </Text>
              <Text style={[styles.cardSub, {color: colors.mutedForeground}]}>
                1st of every month — review your investments
              </Text>
            </View>
            <Switch
              value={investmentAlertsEnabled}
              onValueChange={setInvestmentAlertsEnabled}
              trackColor={{false: colors.muted, true: '#6366F180'}}
              thumbColor={investmentAlertsEnabled ? '#6366F1' : colors.mutedForeground}
            />
          </View>
        </View>

        {/* ── Save ── */}
        <TouchableOpacity
          style={[styles.saveBtn, {backgroundColor: colors.primary, opacity: saving ? 0.7 : 1}]}
          onPress={handleSave}
          disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Icon name="checkmark" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>Save Settings</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingHorizontal: 20,
    paddingBottom:     12,
    gap:               12,
  },
  title: {flex: 1, fontSize: 22, fontWeight: '700', textAlign: 'center'},
  scroll: {padding: 16},

  sectionLabel: {
    fontSize:      12,
    fontWeight:    '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom:  8,
  },
  subLabel: {
    fontSize:      11,
    fontWeight:    '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop:     16,
    marginBottom:  8,
  },

  card: {borderRadius: 14, borderWidth: 1, marginBottom: 0, overflow: 'hidden'},

  cardRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    padding:       16,
  },
  iconBadge: {
    width:         40,
    height:        40,
    borderRadius:  10,
    alignItems:    'center',
    justifyContent: 'center',
  },
  cardInfo:  {flex: 1},
  cardTitle: {fontSize: 15, fontWeight: '600'},
  cardSub:   {fontSize: 12, fontWeight: '400', marginTop: 2},

  freqRow: {
    flexDirection: 'row',
    alignItems:    'center',
    padding:       14,
    gap:           12,
  },
  freqInfo:  {flex: 1},
  freqLabel: {fontSize: 15, fontWeight: '500'},
  freqDesc:  {fontSize: 12, fontWeight: '400', marginTop: 2},
  radio: {
    width:         20,
    height:        20,
    borderRadius:  10,
    borderWidth:   2,
    alignItems:    'center',
    justifyContent: 'center',
  },
  radioDot: {width: 10, height: 10, borderRadius: 5},

  timeRow: {
    flexDirection: 'row',
    alignItems:    'center',
    padding:       16,
    gap:           12,
  },
  timePickerCol: {alignItems: 'center', gap: 4},
  timeLabel: {
    fontSize:      11,
    fontWeight:    '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timePicker:     {height: 120},
  timeItem: {
    width:          52,
    paddingVertical: 8,
    borderRadius:   8,
    alignItems:     'center',
  },
  timeItemText:   {fontSize: 15, fontWeight: '500'},
  timeSep:        {fontSize: 24, fontWeight: '700', marginBottom: 4},
  timeDisplay:    {flex: 1, alignItems: 'center', justifyContent: 'center'},
  timeDisplayText: {fontSize: 32, fontWeight: '700', letterSpacing: -1},
  timeDisplayLabel: {fontSize: 13, fontWeight: '500', marginTop: 2},

  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom:  4,
  },
  dayBtn: {
    width:         42,
    height:        42,
    borderRadius:  21,
    borderWidth:   1,
    alignItems:    'center',
    justifyContent: 'center',
  },
  dayText: {fontSize: 12, fontWeight: '600'},

  stepperRow: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'center',
    gap:           28,
    padding:       16,
  },
  stepperValue: {fontSize: 24, fontWeight: '700', minWidth: 48, textAlign: 'center'},

  customRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    padding:       16,
  },
  customLabel: {fontSize: 15, fontWeight: '500'},
  customInput: {
    width:        72,
    height:       40,
    borderRadius: 10,
    borderWidth:  1,
    textAlign:    'center',
    fontSize:     16,
    fontWeight:   '600',
  },

  thresholdRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    padding:       14,
  },
  thresholdLabel:    {flex: 1, fontSize: 14, fontWeight: '500'},
  thresholdInput: {
    height:       40,
    borderRadius: 10,
    borderWidth:  1,
    paddingHorizontal: 10,
    minWidth:     100,
  },
  thresholdText:     {fontSize: 15, fontWeight: '600'},
  thresholdCurrency: {fontSize: 13, fontWeight: '500'},

  saveBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    height:         54,
    borderRadius:   14,
    marginTop:      28,
  },
  saveBtnText: {color: '#fff', fontSize: 17, fontWeight: '600'},
});
