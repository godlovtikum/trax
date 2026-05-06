import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useAuth} from '../contexts/AuthContext';
import {TabNavigator} from './TabNavigator';
import AuthScreen from '../screens/auth/AuthScreen';
import AddTransactionScreen from '../screens/AddTransactionScreen';
import BudgetScreen from '../screens/BudgetScreen';
import SavingsScreen from '../screens/SavingsScreen';
import CategoriesScreen from '../screens/CategoriesScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import AlertConfigsScreen from '../screens/AlertConfigsScreen';
import SavingsContributionHistoryScreen from '../screens/SavingsContributionHistoryScreen';

export type RootStackParamList = {
  Tabs: undefined;
  Auth: undefined;
  AddTransaction: undefined;
  Budget: undefined;
  Savings: undefined;
  Categories: undefined;
  NotificationSettings: undefined;
  AlertConfigs: undefined;
  GoalHistory: {goalId: string};
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const {session, loading} = useAuth();

  if (loading) return null;

  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      {session ? (
        <>
          <Stack.Screen name="Tabs" component={TabNavigator} />
          <Stack.Screen
            name="AddTransaction"
            component={AddTransactionScreen}
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="Budget"
            component={BudgetScreen}
            options={{animation: 'slide_from_right'}}
          />
          <Stack.Screen
            name="Savings"
            component={SavingsScreen}
            options={{animation: 'slide_from_right'}}
          />
          <Stack.Screen
            name="Categories"
            component={CategoriesScreen}
            options={{animation: 'slide_from_right'}}
          />
          <Stack.Screen
            name="NotificationSettings"
            component={NotificationSettingsScreen}
            options={{animation: 'slide_from_right'}}
          />
          <Stack.Screen
            name="AlertConfigs"
            component={AlertConfigsScreen}
            options={{animation: 'slide_from_right'}}
          />
          <Stack.Screen
            name="GoalHistory"
            component={SavingsContributionHistoryScreen}
            options={{animation: 'slide_from_right'}}
          />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthScreen} />
      )}
    </Stack.Navigator>
  );
}
