import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AppContextValue {
  primaryCurrency: string;
  secondaryCurrency: string;
  setCurrencies: (primary: string, secondary: string) => Promise<void>;
  formatAmount: (amount: number, currency?: string) => string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  XAF: 'FCFA',
  USD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  KES: 'KSh',
  GHS: 'GH₵',
  ZAR: 'R',
  EGP: '£E',
  MAD: 'DH',
};

// Cache one Intl.NumberFormat instance — every `new Intl.NumberFormat(...)`
// allocates a fresh ICU formatter, which is surprisingly expensive on
// low-end Android devices. Re-use one instance across every formatAmount
// call to keep transaction list scrolls smooth.
const sharedNumberFormatter = new Intl.NumberFormat('en', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({children}: {children: React.ReactNode}) {
  const [primaryCurrency, setPrimary] = useState('XAF');
  const [secondaryCurrency, setSecondary] = useState('USD');

  useEffect(() => {
    AsyncStorage.multiGet(['primary_currency', 'secondary_currency']).then(
      pairs => {
        const p = pairs[0][1];
        const s = pairs[1][1];
        if (p) setPrimary(p);
        if (s) setSecondary(s);
      },
    );
  }, []);

  const setCurrencies = useCallback(
    async (primary: string, secondary: string) => {
      setPrimary(primary);
      setSecondary(secondary);
      await AsyncStorage.multiSet([
        ['primary_currency', primary],
        ['secondary_currency', secondary],
      ]);
    },
    [],
  );

  // formatAmount only depends on primaryCurrency for its default branch.
  // useCallback keeps the function reference stable until that changes,
  // so memoized list rows (TransactionCard, BudgetProgressBar, …) don't
  // re-render whenever AppProvider re-renders for unrelated reasons.
  const formatAmount = useCallback(
    (amount: number, currency?: string) => {
      const cur = currency ?? primaryCurrency;
      const symbol = CURRENCY_SYMBOLS[cur] ?? cur;
      return `${symbol} ${sharedNumberFormatter.format(Math.abs(amount))}`;
    },
    [primaryCurrency],
  );

  // Memoize the context value object itself. Without this, every render
  // of AppProvider would hand consumers a fresh object reference and
  // force them all to re-render even when nothing they consume changed.
  const value = useMemo<AppContextValue>(
    () => ({
      primaryCurrency,
      secondaryCurrency,
      setCurrencies,
      formatAmount,
    }),
    [primaryCurrency, secondaryCurrency, setCurrencies, formatAmount],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
