import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {applyTheme,parseThemePreference,readThemePreference,resolveTheme,setThemePreference,THEME_STORAGE_KEY} from './theme';

describe('theme preference',()=>{
  const store=new Map<string,string>();
  const dataset:{theme?:string}={};
  const style={colorScheme:''};
  const meta={content:''};
  let systemDark=false;

  beforeEach(()=>{
    store.clear();
    dataset.theme=undefined;
    style.colorScheme='';
    meta.content='';
    systemDark=false;
    vi.stubGlobal('localStorage',{
      getItem:(key:string)=>store.get(key)??null,
      setItem:(key:string,value:string)=>{store.set(key,value)},
      removeItem:(key:string)=>{store.delete(key)},
    });
    vi.stubGlobal('matchMedia',()=>({matches:systemDark}));
    vi.stubGlobal('document',{
      documentElement:{dataset,style},
      querySelector:()=>meta,
    });
  });

  afterEach(()=>{
    vi.unstubAllGlobals();
  });

  it('defaults to system and follows the device',()=>{
    expect(readThemePreference()).toBe('system');
    expect(resolveTheme()).toBe('light');
    systemDark=true;
    expect(resolveTheme()).toBe('dark');
  });

  it('ignores unknown stored values',()=>{
    store.set(THEME_STORAGE_KEY,'sepia');
    expect(readThemePreference()).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('persists an explicit choice that overrides the device',()=>{
    systemDark=true;
    setThemePreference('light');
    expect(store.get(THEME_STORAGE_KEY)).toBe('light');
    expect(readThemePreference()).toBe('light');
    expect(dataset.theme).toBe('light');
    expect(style.colorScheme).toBe('light');
    expect(meta.content).toBe('#f7f7f4');

    setThemePreference('dark');
    expect(readThemePreference()).toBe('dark');
    expect(dataset.theme).toBe('dark');
    expect(meta.content).toBe('#0F1317');
  });

  it('choosing System clears the saved choice and applies the device theme',()=>{
    setThemePreference('light');
    systemDark=true;
    setThemePreference('system');
    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readThemePreference()).toBe('system');
    expect(dataset.theme).toBe('dark');
  });

  it('still applies the theme when storage is blocked',()=>{
    vi.stubGlobal('localStorage',{
      getItem:()=>{throw new Error('blocked')},
      setItem:()=>{throw new Error('blocked')},
      removeItem:()=>{throw new Error('blocked')},
    });
    expect(readThemePreference()).toBe('system');
    setThemePreference('dark');
    expect(dataset.theme).toBe('dark');
  });

  it('applyTheme sets data-theme and the browser theme color',()=>{
    applyTheme('dark');
    expect(dataset.theme).toBe('dark');
    expect(style.colorScheme).toBe('dark');
    expect(meta.content).toBe('#0F1317');
  });
});
