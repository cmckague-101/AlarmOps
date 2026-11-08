export type FireOpsTheme='light'|'dark';
/** What the user picked in Settings. `system` follows the device. */
export type ThemePreference='system'|FireOpsTheme;

export const THEME_STORAGE_KEY='fireops-theme';
export const THEME_PREFERENCES:readonly ThemePreference[]=['system','light','dark'];
const THEME_COLORS:Record<FireOpsTheme,string>={light:'#f7f7f4',dark:'#0F1317'};
const DARK_QUERY='(prefers-color-scheme: dark)';

// The boot script in index.html mirrors readThemePreference/resolveTheme so
// the right theme is on <html> before first paint. Keep the two in sync.

export function parseThemePreference(value:unknown):ThemePreference{
  return value==='light'||value==='dark'?value:'system';
}

export function readThemePreference():ThemePreference{
  try{
    return parseThemePreference(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
  }catch{
    return 'system';
  }
}

export function systemTheme():FireOpsTheme{
  if(typeof matchMedia!=='function')return 'light';
  return matchMedia(DARK_QUERY).matches?'dark':'light';
}

export function resolveTheme(preference:ThemePreference=readThemePreference()):FireOpsTheme{
  return preference==='system'?systemTheme():preference;
}

export function applyTheme(theme:FireOpsTheme):void{
  if(typeof document==='undefined')return;
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if(meta)meta.content=THEME_COLORS[theme];
}

/** Save the choice for this browser and apply it immediately. */
export function setThemePreference(preference:ThemePreference):void{
  try{
    if(preference==='system')globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
    else globalThis.localStorage?.setItem(THEME_STORAGE_KEY,preference);
  }catch{/* storage blocked: still apply for this page view */}
  applyTheme(resolveTheme(preference));
}
