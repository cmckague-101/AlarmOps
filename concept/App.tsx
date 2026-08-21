import React, {ComponentProps} from 'react';
import {NavigationContainer, DarkTheme, Theme} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {BrandHeader} from './src/components/BrandHeader';
import {FloatingAssistant} from './src/components/FloatingAssistant';
import {FleetMaintenanceScreen} from './src/screens/FleetMaintenanceScreen';
import {IncidentMapScreen} from './src/screens/IncidentMapScreen';
import {DashboardScreen} from './src/screens/DashboardScreen';
import {CommsScreen} from './src/screens/CommsScreen';
import {MoreScreen} from './src/screens/MoreScreen';
import {colors, spacing} from './src/theme';

export type RootTabParamList = {
  Dashboard: undefined;
  Operations: undefined;
  Communications: undefined;
  Fleet: undefined;
  More: undefined;
};

type IconName = ComponentProps<typeof Ionicons>['name'];
const tabIcons: Record<keyof RootTabParamList, IconName> = {
  Dashboard: 'home',
  Operations: 'map',
  Communications: 'chatbubbles',
  Fleet: 'car',
  More: 'apps',
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const navTheme: Theme = {
  ...DarkTheme,
  colors: {...DarkTheme.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.red},
};

export default function App() {
  return <SafeAreaProvider>
    <StatusBar style="light"/>
    <SafeAreaView style={{flex: 1, backgroundColor: colors.background}} edges={['top']}>
      <BrandHeader/>
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator screenOptions={({route}) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.red,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: {fontSize: 10, fontWeight: '700'},
          tabBarStyle: {backgroundColor: colors.surface, borderTopColor: colors.border, height: 68, paddingBottom: spacing.sm, paddingTop: spacing.sm},
          tabBarIcon: ({color, size}) => <Ionicons name={tabIcons[route.name]} size={size} color={color}/>,
        })}>
          <Tab.Screen name="Dashboard" component={DashboardScreen}/>
          <Tab.Screen name="Operations" component={IncidentMapScreen}/>
          <Tab.Screen name="Communications" component={CommsScreen}/>
          <Tab.Screen name="Fleet" component={FleetMaintenanceScreen}/>
          <Tab.Screen name="More" component={MoreScreen}/>
        </Tab.Navigator>
        <FloatingAssistant/>
      </NavigationContainer>
    </SafeAreaView>
  </SafeAreaProvider>;
}
