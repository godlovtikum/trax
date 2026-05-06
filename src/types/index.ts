export type TransactionType     = 'income' | 'expense';
export type BudgetPeriod        = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type NotificationFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';
export type InvestmentType      = 'stocks' | 'crypto' | 'retirement' | 'bonds' | 'real_estate' | 'other';
export type AccountType         = 'cash' | 'bank' | 'mobile_money' | 'other';

export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  primary_currency: string;
  secondary_currency: string;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  type: TransactionType | 'both';
  color: string;
  icon: string;
  is_default: boolean;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  is_default: boolean;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  description?: string;
  date: string;
  is_recurring: boolean;
  recurrence?: 'daily' | 'weekly' | 'monthly';
  receipt_url?: string;
  created_at: string;
  category?: Category;
  account?: Account;
}

export interface Budget {
  id: string;
  user_id: string;
  category_id?: string;
  amount: number;
  period: BudgetPeriod;
  currency: string;
  created_at: string;
  category?: Category;
  spent?: number;
  percentage?: number;
  remaining?: number;
}

export interface SavingsGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  currency: string;
  deadline?: string;
  color: string;
  created_at: string;
}

export interface Investment {
  id: string;
  user_id: string;
  name: string;
  type: InvestmentType;
  amount: number;
  currency: string;
  date: string;
  notes?: string;
  created_at: string;
}

export interface NotificationSettings {
  id: string;
  user_id: string;

  /** Master switch — enables/disables all notification types at once. */
  enabled: boolean;

  /** Frequency + scheduling for the daily transaction reminder. */
  frequency: NotificationFrequency;
  custom_interval_days?: number;
  notification_time: string; // "HH:mm"
  day_of_week?: number;      // 0-6 (Sun-Sat), used with frequency='weekly'
  day_of_month?: number;     // 1-28, used with frequency='monthly'

  /**
   * Spending alerts — a contextual notification fires when the user
   * records a single expense above `spending_alert_threshold` (in the
   * account's currency). Useful as a sanity-check for large outflows.
   */
  spending_alerts_enabled: boolean;
  spending_alert_threshold: number; // default 50 000 XAF

  /**
   * Budget warnings — fires when any active budget's usage crosses 80%
   * of its limit. Delivered at the same time as the daily reminder.
   */
  budget_alerts_enabled: boolean;

  /**
   * Savings progress — a weekly summary that lists each goal's current
   * amount vs. target. Fires on Mondays at `notification_time`.
   */
  savings_alerts_enabled: boolean;

  /**
   * Investment review — a monthly reminder to review portfolio
   * positions. Fires on the 1st of each month at `notification_time`.
   */
  investment_alerts_enabled: boolean;

  created_at: string;
}

// ── Smart alert configurations ────────────────────────────────────────────────

export type NotificationAlertType =
  | 'A1'   // Large expense alert
  | 'A3'   // Weekly spending digest
  | 'A6'   // Recurring expense reminder
  | 'B4'   // Custom budget threshold
  | 'B5'   // Budget reset reminder
  | 'B6'   // Underused budget check
  | 'C4'   // Missed savings contribution
  | 'C5'   // Weekly savings summary
  | 'D3'   // Investment anniversary
  | 'E2'   // Expected income not logged
  | 'E3';  // Expenses exceed income

export interface AlertConfig {
  id: string;
  user_id: string;
  alert_type: NotificationAlertType;
  enabled: boolean;
  notification_time: string; // "HH:mm" 24-hour
  day_of_week?: number;      // 0=Sun … 6=Sat — for weekly alerts (A3, C5)
  day_of_month?: number;     // 1-28 — for monthly / payday alerts (A6, B5, B6, E2)
  threshold_value?: number;  // semantics vary per type (see SQL comments)
  created_at: string;
}

export interface SavingsContribution {
  id: string;
  goal_id: string;
  user_id: string;
  amount: number;
  note?: string;
  contributed_at: string; // "YYYY-MM-DD"
  created_at: string;
}

export interface MonthlyStats {
  income: number;
  expense: number;
  balance: number;
}

export interface CategoryBreakdown {
  name: string;
  color: string;
  icon: string;
  total: number;
}

export interface MonthSeries {
  label: string;
  income: number;
  expense: number;
}
