
# Requested by client to use original color scheme.

export const colors = {
  background: '#0F1317',
  backgroundElevated: '#13191F',
  surface: '#181E24',
  surfaceAlt: '#222A32',
  surfacePressed: '#29333D',
  border: '#303A44',
  borderStrong: '#46525E',
  text: '#F7F8FA',
  textSecondary: '#D7DDE3',
  muted: '#A9B2BC',
  disabled: '#68737E',
  red: '#E83426',
  redDark: '#B82118',
  redSubtle: '#3B211F',
  green: '#3CA66B',
  greenDark: '#26784A',
  greenSubtle: '#193126',
  amber: '#F0A93B',
  amberSubtle: '#3A2D1A',
  blue: '#4E91E6',
  blueSubtle: '#1C2D42',
  white: '#FFFFFF'
} as const;

export type ColorToken = keyof typeof colors;
