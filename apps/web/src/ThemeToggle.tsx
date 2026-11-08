import {useEffect,useState} from 'react';
import {Monitor,Moon,Sun} from 'lucide-react';
import {applyTheme,readThemePreference,resolveTheme,setThemePreference,THEME_PREFERENCES,THEME_STORAGE_KEY,type ThemePreference} from './theme';

const OPTIONS:Record<ThemePreference,{label:string;Icon:typeof Sun}>={
  system:{label:'System',Icon:Monitor},
  light:{label:'Light',Icon:Sun},
  dark:{label:'Dark',Icon:Moon},
};

/** Settings appearance control: System / Light / Dark, saved per browser. */
export default function ThemeToggle(){
  const [preference,setPreference]=useState<ThemePreference>(()=>readThemePreference());

  useEffect(()=>{
    // Another tab changed the choice: follow it here too.
    const sync=(event:StorageEvent)=>{
      if(event.key!==null&&event.key!==THEME_STORAGE_KEY)return;
      const next=readThemePreference();
      setPreference(next);
      applyTheme(resolveTheme(next));
    };
    window.addEventListener('storage',sync);
    return ()=>window.removeEventListener('storage',sync);
  },[]);

  const choose=(next:ThemePreference)=>{
    setThemePreference(next);
    setPreference(next);
  };

  const CurrentIcon=OPTIONS[preference].Icon;
  return <section className="appearance-panel" aria-labelledby="appearance-heading">
    <span className="feedback-mark" aria-hidden="true"><CurrentIcon/></span>
    <div>
      <h2 id="appearance-heading">Appearance</h2>
      <p>Use light or dark mode in this browser, or follow your device.</p>
    </div>
    <div className="theme-choice" role="radiogroup" aria-labelledby="appearance-heading">
      {THEME_PREFERENCES.map(option=>{
        const {label,Icon}=OPTIONS[option];
        const selected=option===preference;
        return <button key={option} type="button" role="radio" aria-checked={selected} className={selected?'active':undefined} onClick={()=>choose(option)}>
          <Icon aria-hidden="true"/>{label}
        </button>;
      })}
    </div>
  </section>;
}
