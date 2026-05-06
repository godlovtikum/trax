import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '../../contexts/AuthContext';
import {useColors} from '../../hooks/useColors';
import {isApiConfigured} from '../../lib/api';

export default function AuthScreen() {
  const {signIn, signUp} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        if (password.length < 6) {
          Alert.alert(
            'Weak password',
            'Password must be at least 6 characters.',
          );
          setLoading(false);
          return;
        }
        await signUp(email.trim(), password, fullName.trim() || undefined);
        Alert.alert(
          'Welcome to TraX!',
          'Your account has been created. You can now sign in.',
        );
        setMode('login');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <LinearGradient
        colors={['#1A56DB', '#0EA5E9']}
        style={[styles.topBg, {paddingTop: insets.top + 16}]}>
        <View style={styles.logoWrap}>
          <View style={styles.logoIcon}>
            <Icon name="swap-horizontal" size={28} color="#fff" />
          </View>
          <Text style={styles.logoText}>TraX</Text>
        </View>
        <Text style={styles.tagline}>Your personal finance, tracked</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.form,
            {paddingBottom: insets.bottom + 32},
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {!isApiConfigured && (
            <View
              style={[
                styles.banner,
                {backgroundColor: '#FEF3C7', borderColor: '#F59E0B'},
              ]}>
              <Icon name="warning-outline" size={16} color="#D97706" />
              <Text style={styles.bannerText}>
                API URL not configured. Set it in src/lib/api.ts.
              </Text>
            </View>
          )}

          <View style={[styles.toggle, {backgroundColor: colors.muted}]}>
            {(['login', 'register'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[
                  styles.toggleBtn,
                  mode === m && {
                    backgroundColor: colors.card,
                    shadowColor: '#000',
                    shadowOpacity: 0.08,
                    shadowRadius: 4,
                    shadowOffset: {width: 0, height: 2},
                    elevation: 2,
                  },
                ]}
                onPress={() => setMode(m)}>
                <Text
                  style={[
                    styles.toggleText,
                    {
                      color:
                        mode === m ? colors.primary : colors.mutedForeground,
                    },
                  ]}>
                  {m === 'login' ? 'Sign In' : 'Sign Up'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'register' && (
            <View style={styles.field}>
              <Text style={[styles.label, {color: colors.mutedForeground}]}>
                Full Name
              </Text>
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: colors.input,
                    borderColor: colors.border,
                  },
                ]}>
                <Icon
                  name="person-outline"
                  size={18}
                  color={colors.mutedForeground}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, {color: colors.foreground}]}
                  placeholder="Your name"
                  placeholderTextColor={colors.mutedForeground}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              </View>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Email
            </Text>
            <View
              style={[
                styles.inputWrap,
                {backgroundColor: colors.input, borderColor: colors.border},
              ]}>
              <Icon
                name="mail-outline"
                size={18}
                color={colors.mutedForeground}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, {color: colors.foreground}]}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Password
            </Text>
            <View
              style={[
                styles.inputWrap,
                {backgroundColor: colors.input, borderColor: colors.border},
              ]}>
              <Icon
                name="lock-closed-outline"
                size={18}
                color={colors.mutedForeground}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, {color: colors.foreground}]}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowPass(v => !v)}
                style={styles.eyeBtn}>
                <Icon
                  name={showPass ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.submitBtn,
              {backgroundColor: colors.primary, opacity: loading ? 0.7 : 1},
            ]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  flex: {flex: 1},
  topBg: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  logoIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -1,
  },
  tagline: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '400',
  },
  form: {padding: 24, gap: 0},
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  bannerText: {
    fontSize: 12,
    color: '#D97706',
    fontWeight: '500',
    flex: 1,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginBottom: 24,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleText: {fontSize: 14, fontWeight: '600'},
  field: {marginBottom: 16},
  label: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {marginRight: 10},
  input: {flex: 1, fontSize: 15, fontWeight: '400'},
  eyeBtn: {padding: 4},
  submitBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
