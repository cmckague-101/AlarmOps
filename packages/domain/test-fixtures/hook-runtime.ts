/** Persistent hook slots for production callback/effect unit tests, not a UI renderer. */
export function createHookRuntime(){
  type Slot={value?:unknown;deps?:readonly unknown[];cleanup?:()=>void;effect?:()=>void|(()=>void)};
  type Frame={slots:Slot[];index:number;effects:Set<number>};
  let active:Frame;
  const changed=(a:readonly unknown[]|undefined,b:readonly unknown[]|undefined)=>!a||!b||a.length!==b.length||a.some((value,index)=>!Object.is(value,b[index]));
  function slot(){const index=active.index++;return {frame:active,index,value:active.slots[index]??(active.slots[index]={})}}
  const hooks={
    useState<T>(initial:T|(()=>T)){
      const {value}=slot();if(!('value' in value))value.value=typeof initial==='function'?(initial as ()=>T)():initial;
      return [value.value as T,(next:T|((old:T)=>T))=>{value.value=typeof next==='function'?(next as (old:T)=>T)(value.value as T):next}] as const;
    },
    useRef<T>(initial:T){const {value}=slot();return (value.value??(value.value={current:initial})) as {current:T}},
    useMemo<T>(fn:()=>T,deps:readonly unknown[]){const {value}=slot();if(changed(value.deps,deps)){value.value=fn();value.deps=deps}return value.value as T},
    useCallback<T>(fn:T,deps:readonly unknown[]){return hooks.useMemo(()=>fn,deps)},
    useEffect(effect:()=>void|(()=>void),deps?:readonly unknown[]){const {frame,index,value}=slot();if(changed(value.deps,deps)){value.deps=deps;value.effect=effect;frame.effects.add(index)}},
    useSyncExternalStore(subscribe:(fn:()=>void)=>()=>void,get:()=>unknown){hooks.useEffect(()=>subscribe(()=>{}),[subscribe]);return get()},
  };
  return {hooks,frame:()=>({slots:[],index:0,effects:new Set<number>()} as Frame),enter:(frame:Frame)=>{active=frame;frame.index=0}};
}
