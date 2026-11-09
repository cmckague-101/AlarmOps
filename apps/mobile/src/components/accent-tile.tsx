import {useEffect,useState} from 'react';
import {AccessibilityInfo,StyleSheet,View,type ViewStyle} from 'react-native';

// Tile accents shared by Command Center, Quick Actions and More, matching web's bottom 3px rails.
export function withAlpha(hex:string,alpha:number):string {
  const value=/^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if(!value)return hex;
  return `#${value}${Math.round(Math.min(1,Math.max(0,alpha))*255).toString(16).padStart(2,'0')}`;
}

export function AccentRail({color}:{color:string}){
  return <View pointerEvents="none" accessible={false} style={[styles.rail,{backgroundColor:color}]}/>;
}

// Press-first feedback: a quick shrink plus a tint in the tile's color (no shrink with Reduce Motion).
export function pressedTileStyle(color:string,{pressed,reduceMotion,scale=.96,tint=.12}:{pressed:boolean;reduceMotion:boolean;scale?:number;tint?:number}):ViewStyle|null {
  if(!pressed)return null;
  return {backgroundColor:withAlpha(color,tint),borderColor:withAlpha(color,.42),...(reduceMotion?{}:{transform:[{scale}]})};
}

export function useReduceMotion(){
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{
    let active=true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(value=>{if(active)setEnabled(value)}).catch(()=>undefined);
    const subscription=AccessibilityInfo.addEventListener?.('reduceMotionChanged',setEnabled);
    return ()=>{active=false;subscription?.remove()};
  },[]);
  return enabled;
}

const styles=StyleSheet.create({rail:{position:'absolute',left:0,right:0,bottom:0,height:3}});
