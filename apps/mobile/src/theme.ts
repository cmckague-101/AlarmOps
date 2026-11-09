import {Appearance,useColorScheme} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {createContext,createElement,useCallback,useContext,useEffect,useMemo,useState,type PropsWithChildren} from 'react';
import {readThemePreference,resolveColorScheme,writeThemePreference,type FireOpsColorScheme,type ThemePreference} from '@/lib/theme-preference';

export type {FireOpsColorScheme,ThemePreference} from '@/lib/theme-preference';

const light={
  canvas:'#F6F7F4',paper:'#FFFFFF',surfaceAlt:'#EEF1ED',ink:'#19201D',secondary:'#5F6963',divider:'#D9DED9',
  command:'#26342C',commandForeground:'#26342C',commandText:'#F4F7F5',ember:'#C94321',emberPressed:'#A93417',green:'#26765A',
  greenSurface:'#E7F3EE',warning:'#7B5014',warningSurface:'#FFF0DF',danger:'#98392E',dangerSurface:'#FAE9E6',blue:'#32699B',blueSurface:'#E7F0F8',
  // Page titles: ink mixed 58/42 with secondary, matching web color-mix(var(--ink) 58%,var(--muted)).
  heroTitle:'#363F3A',
};
const dark={
  canvas:'#0F1317',paper:'#181E24',surfaceAlt:'#222A32',ink:'#F7F8FA',secondary:'#A9B2BC',divider:'#303A44',
  command:'#13191F',commandForeground:'#F7F8FA',commandText:'#F7F8FA',ember:'#E83426',emberPressed:'#B82118',green:'#3CA66B',
  greenSurface:'#193126',warning:'#F0A93B',warningSurface:'#3A2D1A',danger:'#E83426',dangerSurface:'#3B211F',blue:'#4E91E6',blueSurface:'#1C2D42',
  heroTitle:'#D6DBE0',
};

export type FireOpsTheme=typeof light;
type ThemeContextValue={theme:FireOpsTheme;colorScheme:FireOpsColorScheme;preference:ThemePreference;setPreference:(preference:ThemePreference)=>void};
const ThemeContext=createContext<ThemeContextValue|undefined>(undefined);

export function FireOpsThemeProvider({children}:PropsWithChildren){
  // Read synchronously so the first frame already uses the saved choice.
  const [preference,setPreferenceState]=useState<ThemePreference>(()=>readThemePreference(SecureStore));
  const systemScheme=useColorScheme();
  // Native chrome (alerts, pickers, keyboard) follows the override too; System clears it.
  useEffect(()=>{try{Appearance.setColorScheme(preference==='system'?'unspecified':preference)}catch{/* not supported on this platform */}},[preference]);
  const setPreference=useCallback((next:ThemePreference)=>{writeThemePreference(SecureStore,next);setPreferenceState(next)},[]);
  const colorScheme=resolveColorScheme(preference,systemScheme);
  const value=useMemo<ThemeContextValue>(()=>({theme:colorScheme==='dark'?dark:light,colorScheme,preference,setPreference}),[colorScheme,preference,setPreference]);
  return createElement(ThemeContext.Provider,{value},children);
}

function useThemeContext(){
  const value=useContext(ThemeContext);
  if(!value)throw new Error('FireOps theme provider is missing.');
  return value;
}

export function useFireOpsTheme():FireOpsTheme{return useThemeContext().theme}
export function useFireOpsColorScheme(){const {colorScheme}=useThemeContext();return {colorScheme}}
export function useThemePreference(){const {preference,setPreference}=useThemeContext();return {preference,setPreference}}

// Outfit is bundled in assets/fonts and loaded by the root layout; text falls back to the system font until then.
export const heroTitleFontFamily='Outfit-Bold';
// Command Center: incidents rail red, Needs Attention rail yellow (same yellow as web).
export const attentionRailColor='#FFD400';
