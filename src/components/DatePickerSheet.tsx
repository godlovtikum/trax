/**
 * DatePickerSheet — an inline calendar bottom-sheet for selecting a
 * date. Rendered as a full-screen Modal so it layers correctly over the
 * AddTransaction bottom-sheet.
 *
 * No external dependency — built entirely from React Native primitives
 * so the native rebuild cycle doesn't change for this component.
 *
 * Props
 *   visible       — whether the sheet is shown
 *   selectedDate  — the currently selected date, YYYY-MM-DD
 *   maxDate       — optional ceiling (defaults to today; future dates
 *                   are visible but greyed and unselectable)
 *   onConfirm     — called with YYYY-MM-DD when the user taps Confirm
 *   onDismiss     — called when the user taps the backdrop or Cancel
 */
import React, {useState, useCallback, useMemo} from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useColors} from '../hooks/useColors';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface DatePickerSheetProps {
  visible: boolean;
  selectedDate: string;
  onConfirm: (isoDate: string) => void;
  onDismiss: () => void;
  maxDate?: string;
}

function isoToNumbers(isoDate: string): {year: number; month: number; day: number} {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  return {
    year:  parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
    day:   parseInt(dayStr, 10),
  };
}

function numbersToIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Returns an array of 42 cells (6 weeks × 7 days). Each cell is either
 * null (padding before month start) or a day number 1…31.
 */
function buildCalendarCells(year: number, month: number): Array<number | null> {
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const totalDays    = daysInMonth(year, month);
  const cells: Array<number | null> = [];
  for (let padIndex = 0; padIndex < firstWeekday; padIndex++) {
    cells.push(null);
  }
  for (let dayNumber = 1; dayNumber <= totalDays; dayNumber++) {
    cells.push(dayNumber);
  }
  while (cells.length < 42) {
    cells.push(null);
  }
  return cells;
}

export default function DatePickerSheet({
  visible,
  selectedDate,
  onConfirm,
  onDismiss,
  maxDate,
}: DatePickerSheetProps) {
  const colors = useColors();

  const todayIso = new Date().toISOString().split('T')[0];
  const ceilingIso = maxDate ?? todayIso;
  const {year: ceilingYear, month: ceilingMonth, day: ceilingDay} = isoToNumbers(ceilingIso);

  const {year: initialYear, month: initialMonth} = isoToNumbers(selectedDate);
  const [displayYear, setDisplayYear]   = useState(initialYear);
  const [displayMonth, setDisplayMonth] = useState(initialMonth);
  const [pendingDate, setPendingDate]   = useState(selectedDate);

  const calendarCells = useMemo(
    () => buildCalendarCells(displayYear, displayMonth),
    [displayYear, displayMonth],
  );

  const goToPreviousMonth = useCallback(() => {
    if (displayMonth === 1) {
      setDisplayMonth(12);
      setDisplayYear(y => y - 1);
    } else {
      setDisplayMonth(m => m - 1);
    }
  }, [displayMonth]);

  const goToNextMonth = useCallback(() => {
    // Never navigate past the ceiling month.
    if (
      displayYear > ceilingYear ||
      (displayYear === ceilingYear && displayMonth >= ceilingMonth)
    ) {
      return;
    }
    if (displayMonth === 12) {
      setDisplayMonth(1);
      setDisplayYear(y => y + 1);
    } else {
      setDisplayMonth(m => m + 1);
    }
  }, [displayMonth, displayYear, ceilingYear, ceilingMonth]);

  const isNextMonthDisabled =
    displayYear > ceilingYear ||
    (displayYear === ceilingYear && displayMonth >= ceilingMonth);

  const isCellDisabled = useCallback(
    (cellDay: number): boolean => {
      const cellIso = numbersToIso(displayYear, displayMonth, cellDay);
      return cellIso > ceilingIso;
    },
    [displayYear, displayMonth, ceilingIso],
  );

  const handleDayPress = useCallback(
    (cellDay: number) => {
      if (isCellDisabled(cellDay)) return;
      setPendingDate(numbersToIso(displayYear, displayMonth, cellDay));
    },
    [displayYear, displayMonth, isCellDisabled],
  );

  const handleConfirm = () => {
    onConfirm(pendingDate);
  };

  const {
    year: pendingYear,
    month: pendingMonth,
    day: pendingDay,
  } = isoToNumbers(pendingDate);

  const {year: todayYear, month: todayMonth, day: todayDay} = isoToNumbers(todayIso);

  const rows: Array<Array<number | null>> = [];
  for (let rowIndex = 0; rowIndex < 6; rowIndex++) {
    rows.push(calendarCells.slice(rowIndex * 7, rowIndex * 7 + 7));
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} />

      <View style={[styles.sheet, {backgroundColor: colors.card}]}>
        {/* Handle */}
        <View style={[styles.handle, {backgroundColor: colors.border}]} />

        {/* Month navigation */}
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={goToPreviousMonth}
            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
            <Icon name="chevron-back" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <Text style={[styles.monthLabel, {color: colors.foreground}]}>
            {MONTH_NAMES[displayMonth - 1]} {displayYear}
          </Text>

          <TouchableOpacity
            onPress={goToNextMonth}
            disabled={isNextMonthDisabled}
            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
            <Icon
              name="chevron-forward"
              size={22}
              color={isNextMonthDisabled ? colors.border : colors.foreground}
            />
          </TouchableOpacity>
        </View>

        {/* Weekday headers */}
        <View style={styles.weekRow}>
          {WEEK_DAYS.map(weekday => (
            <Text
              key={weekday}
              style={[styles.weekdayLabel, {color: colors.mutedForeground}]}>
              {weekday}
            </Text>
          ))}
        </View>

        {/* Day grid */}
        {rows.map((calendarRow, rowIndex) => (
          <View key={rowIndex} style={styles.weekRow}>
            {calendarRow.map((cellDay, colIndex) => {
              if (cellDay === null) {
                return <View key={colIndex} style={styles.dayCell} />;
              }

              const isSelected =
                cellDay === pendingDay &&
                displayMonth === pendingMonth &&
                displayYear === pendingYear;

              const isToday =
                cellDay === todayDay &&
                displayMonth === todayMonth &&
                displayYear === todayYear;

              const isDisabled = isCellDisabled(cellDay);

              return (
                <TouchableOpacity
                  key={colIndex}
                  style={[
                    styles.dayCell,
                    isSelected && {backgroundColor: colors.primary},
                    !isSelected && isToday && {
                      borderWidth: 1.5,
                      borderColor: colors.primary,
                    },
                  ]}
                  onPress={() => handleDayPress(cellDay)}
                  disabled={isDisabled}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      styles.dayText,
                      {color: colors.foreground},
                      isSelected && {color: '#fff', fontWeight: '700'},
                      isDisabled && {color: colors.border},
                      isToday && !isSelected && {color: colors.primary, fontWeight: '600'},
                    ]}>
                    {cellDay}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* Selected date display */}
        <Text style={[styles.selectedDisplay, {color: colors.mutedForeground}]}>
          Selected:{' '}
          <Text style={{color: colors.foreground, fontWeight: '600'}}>
            {new Date(pendingDate + 'T00:00:00').toLocaleDateString('en', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </Text>

        {/* Actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.cancelBtn, {borderColor: colors.border}]}
            onPress={onDismiss}>
            <Text style={[styles.cancelText, {color: colors.mutedForeground}]}>
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.confirmBtn, {backgroundColor: colors.primary}]}
            onPress={handleConfirm}>
            <Icon name="checkmark" size={18} color="#fff" />
            <Text style={styles.confirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  monthLabel: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 4,
  },
  weekdayLabel: {
    width: 40,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingVertical: 4,
  },
  dayCell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: {
    fontSize: 14,
    fontWeight: '400',
  },
  selectedDisplay: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 2,
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
