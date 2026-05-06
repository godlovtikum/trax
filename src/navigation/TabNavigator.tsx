import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
} from 'react-native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';

import DashboardScreen from '../screens/tabs/DashboardScreen';
import TransactionsScreen from '../screens/tabs/TransactionsScreen';
import ReportsScreen from '../screens/tabs/ReportsScreen';
import SettingsScreen from '../screens/tabs/SettingsScreen';
import {useColors} from '../hooks/useColors';
import type {RootStackParamList} from './RootNavigator';

export type TabParamList = {
  Home: undefined;
  Transactions: undefined;
  AddPlaceholder: undefined;
  Reports: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

// Invisible placeholder screen — the Add tab opens a modal instead.
function AddPlaceholderScreen() {
  return <View />;
}

function AddButton() {
  const colors = useColors();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <TouchableOpacity
      style={[styles.addBtn, {backgroundColor: colors.primary}]}
      onPress={() => navigation.navigate('AddTransaction')}
      activeOpacity={0.85}>
      <Icon name="add" size={26} color="#fff" />
    </TouchableOpacity>
  );
}

export function TabNavigator() {
  const colors = useColors();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}>
      <Tab.Screen
        name="Home"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{
          title: 'History',
          tabBarIcon: ({color, size}) => (
            <Feather name="list" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="AddPlaceholder"
        component={AddPlaceholderScreen}
        options={{
          title: '',
          tabBarLabel: () => null,
          tabBarIcon: () => <AddButton />,
          tabBarButton: props => (
            <TouchableOpacity {...props} style={styles.addTabBtn} />
          ),
        }}
      />
      <Tab.Screen
        name="Reports"
        component={ReportsScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Feather name="bar-chart-2" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#1A56DB',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
    elevation: 6,
  },
  addTabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
