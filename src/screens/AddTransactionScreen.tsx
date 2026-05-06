import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Switch,
  ActivityIndicator,
  Platform,
  Vibration,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {useApp} from '../contexts/AppContext';
import {
  addTransaction,
  getCategories,
  getDefaultAccount,
} from '../lib/database';
import type {Category, TransactionType} from '../types';
import type {RootStackParamList} from '../navigation/RootNavigator';
import DatePickerSheet from '../components/DatePickerSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const hapticSelection = () => {
  if (Platform.OS !== 'web') Vibration.vibrate(10);
};
const hapticSuccess = () => {
  if (Platform.OS !== 'web') Vibration.vibrate([0, 40, 30, 40]);
};

function formatDisplayDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    year:    'numeric',
  });
}

export default function AddTransactionScreen() {
  const {session}        = useAuth();
  const colors           = useColors();
  const insets           = useSafeAreaInsets();
  const {primaryCurrency} = useApp();
  const queryClient      = useQueryClient();
  const navigation       = useNavigation<Nav>();

  const todayIso = new Date().toISOString().split('T')[0];

  const [transactionType, setTransactionType] = useState<TransactionType>('expense');
  const [amount, setAmount]                   = useState('');
  const [description, setDescription]         = useState('');
  const [selectedDate, setSelectedDate]       = useState(todayIso);
  const [isRecurring, setIsRecurring]         = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);

  const userId = session?.user.id;

  const {data: categories = []} = useQuery({
    queryKey: ['categories', userId],
    queryFn:  () => getCategories(userId!),
    enabled:  !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const {data: defaultAccount} = useQuery({
    queryKey: ['default-account', userId],
    queryFn:  () => getDefaultAccount(userId!),
    enabled:  !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const filteredCategories = categories.filter(
    category => category.type === transactionType || category.type === 'both',
  );

  const handleSave = async () => {
    if (!session) return;
    const parsedAmount = parseFloat(amount.replace(/,/g, ''));
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    if (!selectedCategory) {
      Alert.alert('Category required', 'Please select a category.');
      return;
    }

    setSaving(true);
    try {
      await addTransaction({
        user_id:      session.user.id,
        account_id:   defaultAccount?.id ?? '',
        category_id:  selectedCategory.id,
        type:         transactionType,
        amount:       parsedAmount,
        currency:     primaryCurrency,
        description:  description.trim() || undefined,
        date:         selectedDate,
        is_recurring: isRecurring,
      });
      hapticSuccess();
      queryClient.invalidateQueries({queryKey: ['transactions']});
      queryClient.invalidateQueries({queryKey: ['monthly-stats']});
      queryClient.invalidateQueries({queryKey: ['budget-usage']});
      queryClient.invalidateQueries({queryKey: ['transactions-recent']});
      navigation.goBack();
    } catch (saveError: any) {
      Alert.alert('Error', saveError.message ?? 'Failed to save transaction.');
    } finally {
      setSaving(false);
    }
  };

  const handleDateConfirm = (confirmedDate: string) => {
    setSelectedDate(confirmedDate);
    setCalendarVisible(false);
    hapticSelection();
  };

  const bottomPad = insets.bottom;

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, {paddingTop: 12}]}>
        <View style={[styles.handle, {backgroundColor: colors.border}]} />
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, {color: colors.foreground}]}>
            Add Transaction
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {paddingBottom: bottomPad + 24},
        ]}
        keyboardShouldPersistTaps="handled">

        {/* ── Type toggle ── */}
        <View style={[styles.typeToggle, {backgroundColor: colors.muted}]}>
          {(['expense', 'income'] as TransactionType[]).map(typeOption => (
            <TouchableOpacity
              key={typeOption}
              style={[
                styles.typeBtn,
                transactionType === typeOption && {
                  backgroundColor:
                    typeOption === 'income' ? colors.income : colors.expense,
                },
              ]}
              onPress={() => {
                setTransactionType(typeOption);
                setSelectedCategory(null);
                hapticSelection();
              }}>
              <Icon
                name={typeOption === 'income' ? 'arrow-down-outline' : 'arrow-up-outline'}
                size={16}
                color={transactionType === typeOption ? '#fff' : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.typeBtnText,
                  {color: transactionType === typeOption ? '#fff' : colors.mutedForeground},
                ]}>
                {typeOption.charAt(0).toUpperCase() + typeOption.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Amount ── */}
        <View style={styles.amountSection}>
          <Text style={[styles.currency, {color: colors.mutedForeground}]}>
            {primaryCurrency}
          </Text>
          <TextInput
            style={[
              styles.amountInput,
              {color: transactionType === 'income' ? colors.income : colors.expense},
            ]}
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={colors.border}
            keyboardType="decimal-pad"
            autoFocus
          />
        </View>

        {/* ── Category ── */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground}]}>
          Category
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.catScroll}>
          {filteredCategories.map(category => (
            <TouchableOpacity
              key={category.id}
              style={[
                styles.catChip,
                {
                  backgroundColor:
                    selectedCategory?.id === category.id
                      ? category.color + '25'
                      : colors.card,
                  borderColor:
                    selectedCategory?.id === category.id
                      ? category.color
                      : colors.border,
                },
              ]}
              onPress={() => {
                setSelectedCategory(category);
                hapticSelection();
              }}>
              <Icon name={category.icon as any} size={18} color={category.color} />
              <Text
                style={[
                  styles.catChipText,
                  {
                    color:
                      selectedCategory?.id === category.id
                        ? category.color
                        : colors.foreground,
                  },
                ]}>
                {category.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Note ── */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground}]}>
          Note (optional)
        </Text>
        <TextInput
          style={[
            styles.noteInput,
            {
              backgroundColor: colors.input,
              borderColor:     colors.border,
              color:           colors.foreground,
            },
          ]}
          placeholder="Add a note..."
          placeholderTextColor={colors.mutedForeground}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={200}
        />

        {/* ── Date — tap to open calendar ── */}
        <Text style={[styles.sectionLabel, {color: colors.mutedForeground}]}>
          Date
        </Text>
        <TouchableOpacity
          style={[
            styles.dateButton,
            {backgroundColor: colors.input, borderColor: colors.border},
          ]}
          onPress={() => setCalendarVisible(true)}
          activeOpacity={0.7}>
          <Icon
            name="calendar-outline"
            size={18}
            color={colors.primary}
            style={styles.dateIcon}
          />
          <Text style={[styles.dateText, {color: colors.foreground}]}>
            {formatDisplayDate(selectedDate)}
          </Text>
          <Icon
            name="chevron-forward"
            size={16}
            color={colors.mutedForeground}
          />
        </TouchableOpacity>

        {/* ── Recurring toggle ── */}
        <View style={[styles.recurRow, {borderColor: colors.border}]}>
          <Icon name="repeat-outline" size={20} color={colors.primary} />
          <Text style={[styles.recurLabel, {color: colors.foreground}]}>
            Recurring
          </Text>
          <Switch
            value={isRecurring}
            onValueChange={newValue => {
              setIsRecurring(newValue);
              hapticSelection();
            }}
            trackColor={{false: colors.muted, true: colors.primary + '80'}}
            thumbColor={isRecurring ? colors.primary : colors.mutedForeground}
          />
        </View>

        {/* ── Save button ── */}
        <TouchableOpacity
          style={[
            styles.saveBtn,
            {
              backgroundColor:
                transactionType === 'income' ? colors.income : colors.expense,
              opacity: saving ? 0.7 : 1,
            },
          ]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="checkmark" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Calendar sheet (Modal overlay) ── */}
      <DatePickerSheet
        visible={calendarVisible}
        selectedDate={selectedDate}
        onConfirm={handleDateConfirm}
        onDismiss={() => setCalendarVisible(false)}
        maxDate={todayIso}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:   {flex: 1},
  topBar: {paddingHorizontal: 20, paddingBottom: 4},
  handle: {
    width:     36,
    height:    4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  headerTitle: {fontSize: 18, fontWeight: '700'},
  scroll:      {paddingHorizontal: 20, paddingTop: 16},

  typeToggle: {
    flexDirection: 'row',
    borderRadius:  12,
    padding:       4,
    marginBottom:  24,
  },
  typeBtn: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    paddingVertical: 10,
    borderRadius:   10,
  },
  typeBtnText: {fontSize: 15, fontWeight: '600'},

  amountSection: {alignItems: 'center', marginBottom: 28},
  currency:      {fontSize: 16, fontWeight: '500', marginBottom: 4},
  amountInput: {
    fontSize:   52,
    fontWeight: '700',
    textAlign:  'center',
    minWidth:   100,
  },

  sectionLabel: {
    fontSize:      11,
    fontWeight:    '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom:  8,
    marginTop:     8,
  },

  catScroll: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    marginBottom:      8,
  },
  catChip: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    paddingHorizontal: 14,
    paddingVertical:   9,
    borderRadius:  20,
    borderWidth:   1.5,
    marginRight:   8,
  },
  catChipText: {fontSize: 13, fontWeight: '500'},

  noteInput: {
    borderRadius:    12,
    borderWidth:     1,
    padding:         12,
    fontSize:        14,
    fontWeight:      '400',
    minHeight:       70,
    marginBottom:    8,
    textAlignVertical: 'top',
  },

  // Date selector — tap to open calendar
  dateButton: {
    flexDirection:  'row',
    alignItems:     'center',
    borderRadius:   12,
    borderWidth:    1,
    paddingVertical:   14,
    paddingHorizontal: 14,
    marginBottom:   8,
    gap:            10,
  },
  dateIcon: {},
  dateText: {flex: 1, fontSize: 15, fontWeight: '500'},

  recurRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    paddingVertical:    14,
    borderTopWidth:     StyleSheet.hairlineWidth,
    borderBottomWidth:  StyleSheet.hairlineWidth,
    marginVertical:     8,
  },
  recurLabel: {flex: 1, fontSize: 15, fontWeight: '500'},

  saveBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    height:         54,
    borderRadius:   14,
    marginTop:      16,
  },
  saveBtnText: {color: '#fff', fontSize: 17, fontWeight: '600'},
});
