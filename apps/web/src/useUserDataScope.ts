import {useCallback,useEffect,useRef} from 'react';

/** Opaque generation: stale callbacks stay invalid even across A → B → A. */
export function useUserDataScope(key:string){
  const ref=useRef({key,active:true});
  if(ref.current.key!==key)ref.current={key,active:true};
  const token=ref.current;
  useEffect(()=>{token.active=true;return()=>{token.active=false}},[token]);
  const current=useCallback(()=>ref.current===token&&token.active,[token]);
  return {token,current};
}
