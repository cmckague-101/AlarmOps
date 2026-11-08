import {describe,expect,it,vi} from 'vitest';
import {parseThemePreference,readThemePreference,resolveColorScheme,THEME_PREFERENCE_KEY,writeThemePreference} from './theme-preference';

function memoryStore(){
  const values=new Map<string,string>();
  return {
    values,
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value)},
    deleteItemAsync:async(key:string)=>{values.delete(key)},
  };
}

describe('theme preference',()=>{
  it('defaults to system for missing or unknown values',()=>{
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('follows the device on System and overrides it on Light/Dark',()=>{
    expect(resolveColorScheme('system','dark')).toBe('dark');
    expect(resolveColorScheme('system','light')).toBe('light');
    expect(resolveColorScheme('system',null)).toBe('light');
    expect(resolveColorScheme('light','dark')).toBe('light');
    expect(resolveColorScheme('dark','light')).toBe('dark');
  });

  it('saves Light/Dark on the device and clears it for System',async()=>{
    const store=memoryStore();
    expect(readThemePreference(store)).toBe('system');
    writeThemePreference(store,'dark');
    expect(store.values.get(THEME_PREFERENCE_KEY)).toBe('dark');
    expect(readThemePreference(store)).toBe('dark');
    writeThemePreference(store,'system');
    await Promise.resolve();
    expect(store.values.has(THEME_PREFERENCE_KEY)).toBe(false);
    expect(readThemePreference(store)).toBe('system');
  });

  it('falls back to System when storage fails',()=>{
    const broken={getItem:vi.fn(()=>{throw new Error('locked')}),setItem:vi.fn(()=>{throw new Error('locked')}),deleteItemAsync:vi.fn(()=>Promise.reject(new Error('locked')))};
    expect(readThemePreference(broken)).toBe('system');
    expect(()=>writeThemePreference(broken,'light')).not.toThrow();
    expect(()=>writeThemePreference(broken,'system')).not.toThrow();
  });
});
