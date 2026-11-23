import {createContext,useContext,useMemo,useState,type PropsWithChildren} from 'react';
import {demoTechTime,emptyTechTime,seedAlarmBook,type AlarmBook,type TechTimeLog} from '@fireops/domain';
import {useSession} from '@/providers/session-provider';

type AlarmBookValue={book:AlarmBook;setBook:(book:AlarmBook)=>void;techTime:TechTimeLog;setTechTime:(log:TechTimeLog)=>void;today:string};
const AlarmBookContext=createContext<AlarmBookValue|null>(null);

function AlarmBookState({demoMode,children}:PropsWithChildren<{demoMode:boolean}>){
  const [book,setBook]=useState(seedAlarmBook);
  const [techTime,setTechTime]=useState(()=>demoMode?demoTechTime():emptyTechTime());
  const today=useMemo(()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`},[]);
  const value=useMemo(()=>({book,setBook,techTime,setTechTime,today}),[book,techTime,today]);
  return <AlarmBookContext.Provider value={value}>{children}</AlarmBookContext.Provider>;
}

/** Fresh sample book when demo mode starts or ends. Live edits last for this app session. */
export function AlarmBookProvider({children}:PropsWithChildren){
  const {demoMode}=useSession();
  return <AlarmBookState key={demoMode?'demo':'live'} demoMode={demoMode}>{children}</AlarmBookState>;
}

export function useAlarmBook(){
  const value=useContext(AlarmBookContext);
  if(!value)throw new Error('Alarm book is missing.');
  return value;
}
