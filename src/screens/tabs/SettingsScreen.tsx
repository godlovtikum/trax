import React, {useState} from 'react';
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
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '../../contexts/AuthContext';
import {useApp} from '../../contexts/AppContext';
import {useColors} from '../../hooks/useColors';
import {updateProfile} from '../../lib/database';
import type {RootStackParamList} from '../../navigation/RootNavigator';

const CURRENCIES = [
  'XAF', 'USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'EGP', 'MAD',
];
type Nav = NativeStackNavigationProp<RootStackParamList>;

function SettingsRow({
  icon,
  label,
  onPress,
  value,
  danger,
}: {
  icon: string;
  label: string;
  onPress?: () => void;
  value?: string;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.row, {borderBottomColor: colors.border}]}
      onPress={onPress}
      activeOpacity={0.7}>
      <Icon
        name={icon as any}
        size={20}
        color={danger ? colors.expense : colors.primary}
      />
      <Text
        style={[
          styles.rowLabel,
          {color: danger ? colors.expense : colors.foreground},
        ]}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        {value && (
          <Text style={[styles.rowValue, {color: colors.mutedForeground}]}>
            {value}
          </Text>
        )}
        {!danger && (
          <Icon
            name="chevron-forward"
            size={16}
            color={colors.mutedForeground}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const {session, profile, signOut, refreshProfile} = useAuth();
  const {primaryCurrency, secondaryCurrency, setCurrencies} = useApp();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(profile?.full_name ?? '');
  const [savingName, setSavingName] = useState(false);

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      await updateProfile(session!.user.id, {full_name: name.trim()});
      await refreshProfile();
      setEditName(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingName(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Sign Out', style: 'destructive', onPress: signOut},
    ]);
  };

  const handleCurrencySelect = (field: 'primary' | 'secondary') => {
    const current = field === 'primary' ? primaryCurrency : secondaryCurrency;
    Alert.alert('Select Currency', undefined, [
      ...CURRENCIES.map(c => ({
        text: `${c}${c === current ? ' ✓' : ''}`,
        onPress: () => {
          if (field === 'primary') setCurrencies(c, secondaryCurrency);
          else setCurrencies(primaryCurrency, c);
        },
      })),
      {text: 'Cancel', style: 'cancel'},
    ]);
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={[styles.title, {color: colors.foreground}]}>Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {paddingBottom: insets.bottom + 90},
        ]}>
        <View
          style={[
            styles.section,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.sectionTitle, {color: colors.mutedForeground}]}>
            PROFILE
          </Text>
          <View style={styles.profileRow}>
            <View style={[styles.avatar, {backgroundColor: colors.primary}]}>
              <Text style={styles.avatarText}>
                {(
                  profile?.full_name ??
                  session!.user.email ??
                  '?'
                )[0].toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              {editName ? (
                <View style={styles.nameEdit}>
                  <TextInput
                    style={[
                      styles.nameInput,
                      {
                        color: colors.foreground,
                        borderColor: colors.border,
                      },
                    ]}
                    value={name}
                    onChangeText={setName}
                    autoFocus
                  />
                  <TouchableOpacity
                    onPress={handleSaveName}
                    disabled={savingName}>
                    {savingName ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Icon
                        name="checkmark-circle"
                        size={24}
                        color={colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditName(false)}>
                    <Icon
                      name="close-circle"
                      size={24}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.nameRow}>
                  <Text style={[styles.profileName, {color: colors.foreground}]}>
                    {profile?.full_name || 'Set your name'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setName(profile?.full_name ?? '');
                      setEditName(true);
                    }}>
                    <Icon
                      name="pencil-outline"
                      size={16}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                </View>
              )}
              <Text
                style={[styles.profileEmail, {color: colors.mutedForeground}]}>
                {session!.user.email}
              </Text>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.section,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.sectionTitle, {color: colors.mutedForeground}]}>
            FINANCE
          </Text>
          <SettingsRow
            icon="pie-chart-outline"
            label="Budgets"
            onPress={() => navigation.navigate('Budget')}
          />
          <SettingsRow
            icon="rocket-outline"
            label="Savings & Investments"
            onPress={() => navigation.navigate('Savings')}
          />
          <SettingsRow
            icon="pricetags-outline"
            label="Categories"
            onPress={() => navigation.navigate('Categories')}
          />
        </View>

        <View
          style={[
            styles.section,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.sectionTitle, {color: colors.mutedForeground}]}>
            CURRENCY
          </Text>
          <SettingsRow
            icon="cash-outline"
            label="Primary Currency"
            value={primaryCurrency}
            onPress={() => handleCurrencySelect('primary')}
          />
          <SettingsRow
            icon="swap-horizontal-outline"
            label="Secondary Currency"
            value={secondaryCurrency}
            onPress={() => handleCurrencySelect('secondary')}
          />
        </View>

        <View
          style={[
            styles.section,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.sectionTitle, {color: colors.mutedForeground}]}>
            NOTIFICATIONS
          </Text>
          <SettingsRow
            icon="notifications-outline"
            label="Reminder Settings"
            onPress={() => navigation.navigate('NotificationSettings')}
          />
          <SettingsRow
            icon="flash-outline"
            label="Smart Alerts"
            onPress={() => navigation.navigate('AlertConfigs')}
          />
        </View>

        <View
          style={[
            styles.section,
            {backgroundColor: colors.card, borderColor: colors.border},
          ]}>
          <Text style={[styles.sectionTitle, {color: colors.mutedForeground}]}>
            ACCOUNT
          </Text>
          <SettingsRow
            icon="log-out-outline"
            label="Sign Out"
            onPress={handleSignOut}
            danger
          />
        </View>

        <Text style={[styles.version, {color: colors.mutedForeground}]}>
          TraX v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {paddingHorizontal: 20, paddingBottom: 12},
  title: {fontSize: 28, fontWeight: '700'},
  scroll: {padding: 16, gap: 12},
  section: {borderRadius: 14, borderWidth: 1, overflow: 'hidden'},
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    padding: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {flex: 1, fontSize: 15, fontWeight: '500'},
  rowRight: {flexDirection: 'row', alignItems: 'center', gap: 6},
  rowValue: {fontSize: 14, fontWeight: '400'},
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {color: '#fff', fontSize: 20, fontWeight: '700'},
  profileInfo: {flex: 1},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  profileName: {fontSize: 16, fontWeight: '600'},
  profileEmail: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  nameEdit: {flexDirection: 'row', alignItems: 'center', gap: 8},
  nameInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 8,
  },
});
