import * as SecureStore from 'expo-secure-store';
import {Appearance,useColorScheme} from 'react-native';
import {createContext,createElement,useCallback,useContext,useEffect,useMemo,useState,type PropsWithChildren} from 'react';

const light={
  canvas:'#F6F7F4',paper:'#FFFFFF',surfaceAlt:'#EEF1ED',ink:'#19201D',secondary:'#5F6963',divider:'#D9DED9',
  command:'#26342C',commandForeground:'#26342C',commandText:'#F4F7F5',ember:'#C94321',emberPressed:'#A93417',green:'#26765A',
  greenSurface:'#E7F3EE',warning:'#7B5014',warningSurface:'#FFF0DF',danger:'#98392E',dangerSurface:'#FAE9E6',
};
const dark={
  canvas:'#0F1317',paper:'#181E24',surfaceAlt:'#222A32',ink:'#F7F8FA',secondary:'#A9B2BC',divider:'#303A44',
  command:'#13191F',commandForeground:'#F7F8FA',commandText:'#F7F8FA',ember:'#E83426',emberPressed:'#B82118',green:'#3CA66B',
  greenSurface:'#193126',warning:'#F0A93B',warningSurface:'#3A2D1A',danger:'#E83426',dangerSurface:'#3B211F',
};

const storageKey='fireops-theme';
export type FireOpsTheme=typeof light;
export type FireOpsColorScheme='light'|'dark';
type ThemeContextValue={theme:FireOpsTheme;colorScheme:FireOpsColorScheme;setColorScheme:(scheme:FireOpsColorScheme)=>void};
const ThemeContext=createContext<ThemeContextValue|undefined>(undefined);

export function FireOpsThemeProvider({children}:PropsWithChildren){
  const systemScheme=useColorScheme();
  const [colorScheme,setStoredScheme]=useState<FireOpsColorScheme>(systemScheme==='dark'?'dark':'light');
  useEffect(()=>{
    let active=true;
    void SecureStore.getItemAsync(storageKey).then(value=>{
      if(!active||(value!=='light'&&value!=='dark'))return;
      setStoredScheme(value);
      Appearance.setColorScheme(value);
    }).catch(()=>{});
    return()=>{active=false};
  },[]);
  const setColorScheme=useCallback((scheme:FireOpsColorScheme)=>{
    setStoredScheme(scheme);
    Appearance.setColorScheme(scheme);
    void SecureStore.setItemAsync(storageKey,scheme).catch(()=>{});
  },[]);
  const value=useMemo<ThemeContextValue>(()=>({theme:colorScheme==='dark'?dark:light,colorScheme,setColorScheme}),[colorScheme,setColorScheme]);
  return createElement(ThemeContext.Provider,{value},children);
}

function useThemeContext(){
  const value=useContext(ThemeContext);
  if(!value)throw new Error('FireOps theme provider is missing.');
  return value;
}

export function useFireOpsTheme():FireOpsTheme{return useThemeContext().theme}
export function useFireOpsColorScheme(){const {colorScheme,setColorScheme}=useThemeContext();return {colorScheme,setColorScheme}}
