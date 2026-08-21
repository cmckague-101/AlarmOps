import {Platform, TextStyle, ViewStyle} from 'react-native';

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  screen: 16,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  round: 999,
} as const;

export const typography = {
  overline: {fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 1.2} as TextStyle,
  screenTitle: {fontSize: 28, lineHeight: 34, fontWeight: '900'} as TextStyle,
  sectionTitle: {fontSize: 18, lineHeight: 24, fontWeight: '900'} as TextStyle,
  cardTitle: {fontSize: 16, lineHeight: 22, fontWeight: '900'} as TextStyle,
  body: {fontSize: 14, lineHeight: 20, fontWeight: '400'} as TextStyle,
  bodyStrong: {fontSize: 14, lineHeight: 20, fontWeight: '800'} as TextStyle,
  label: {fontSize: 12, lineHeight: 16, fontWeight: '800'} as TextStyle,
  caption: {fontSize: 11, lineHeight: 15, fontWeight: '600'} as TextStyle,
  metric: {fontSize: 26, lineHeight: 31, fontWeight: '900'} as TextStyle,
} as const;

export const shadows = {
  card: Platform.select<ViewStyle>({
    ios: {shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: {width: 0, height: 3}},
    android: {elevation: 3},
    default: {boxShadow: '0 3px 8px rgba(0,0,0,0.22)'} as ViewStyle,
  }) ?? {},
  floating: Platform.select<ViewStyle>({
    ios: {shadowColor: '#000000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: {width: 0, height: 5}},
    android: {elevation: 10},
    default: {boxShadow: '0 5px 10px rgba(0,0,0,0.4)'} as ViewStyle,
  }) ?? {},
} as const;
