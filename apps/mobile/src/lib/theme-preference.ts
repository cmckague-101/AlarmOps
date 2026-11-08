export type FireOpsColorScheme='light'|'dark';
/** What the user picked in Settings. `system` follows the device. */
export type ThemePreference='system'|FireOpsColorScheme;

export const THEME_PREFERENCE_KEY='fireops-theme';
export const THEME_PREFERENCES:readonly ThemePreference[]=['system','light','dark'];
export const THEME_PREFERENCE_LABELS:Record<ThemePreference,string>={system:'System',light:'Light',dark:'Dark'};

export function parseThemePreference(value:unknown):ThemePreference{
  return value==='light'||value==='dark'?value:'system';
}

/** A saved Light/Dark choice wins; otherwise use the device scheme (light if unknown). */
export function resolveColorScheme(preference:ThemePreference,systemScheme:string|null|undefined):FireOpsColorScheme{
  if(preference!=='system')return preference;
  return systemScheme==='dark'?'dark':'light';
}

type PreferenceStore={getItem(key:string):string|null;setItem(key:string,value:string):void;deleteItemAsync(key:string):Promise<void>};

export function readThemePreference(store:PreferenceStore):ThemePreference{
  try{return parseThemePreference(store.getItem(THEME_PREFERENCE_KEY))}catch{return 'system'}
}

export function writeThemePreference(store:PreferenceStore,preference:ThemePreference):void{
  try{
    if(preference==='system')void store.deleteItemAsync(THEME_PREFERENCE_KEY).catch(()=>undefined);
    else store.setItem(THEME_PREFERENCE_KEY,preference);
  }catch{/* keep the in-memory choice for this session */}
}
