import {useColorScheme} from 'react-native';
import {createContext,createElement,useContext,useMemo,type PropsWithChildren} from 'react';

const light={
  canvas:'#F6F7F4',paper:'#FFFFFF',surfaceAlt:'#EEF1ED',ink:'#19201D',secondary:'#5F6963',divider:'#D9DED9',
  command:'#26342C',commandForeground:'#26342C',commandText:'#F4F7F5',ember:'#C94321',emberPressed:'#A93417',green:'#26765A',
  greenSurface:'#E7F3EE',warning:'#7B5014',warningSurface:'#FFF0DF',danger:'#98392E',dangerSurface:'#FAE9E6',blue:'#32699B',blueSurface:'#E7F0F8',
};
const dark={
  canvas:'#0F1317',paper:'#181E24',surfaceAlt:'#222A32',ink:'#F7F8FA',secondary:'#A9B2BC',divider:'#303A44',
  command:'#13191F',commandForeground:'#F7F8FA',commandText:'#F7F8FA',ember:'#E83426',emberPressed:'#B82118',green:'#3CA66B',
  greenSurface:'#193126',warning:'#F0A93B',warningSurface:'#3A2D1A',danger:'#E83426',dangerSurface:'#3B211F',blue:'#4E91E6',blueSurface:'#1C2D42',
};

export type FireOpsTheme=typeof light;
export type FireOpsColorScheme='light'|'dark';
type ThemeContextValue={theme:FireOpsTheme;colorScheme:FireOpsColorScheme};
const ThemeContext=createContext<ThemeContextValue|undefined>(undefined);

export function FireOpsThemeProvider({children}:PropsWithChildren){
  const systemScheme=useColorScheme();
  const colorScheme:FireOpsColorScheme=systemScheme==='dark'?'dark':'light';
  const value=useMemo<ThemeContextValue>(()=>({theme:colorScheme==='dark'?dark:light,colorScheme}),[colorScheme]);
  return createElement(ThemeContext.Provider,{value},children);
}

function useThemeContext(){
  const value=useContext(ThemeContext);
  if(!value)throw new Error('FireOps theme provider is missing.');
  return value;
}

export function useFireOpsTheme():FireOpsTheme{return useThemeContext().theme}
export function useFireOpsColorScheme(){const {colorScheme}=useThemeContext();return {colorScheme}}
