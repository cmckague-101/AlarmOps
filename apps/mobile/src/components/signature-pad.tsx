import {useEffect,useMemo,useState} from 'react';
import {Pressable,StyleSheet,Text,View,type GestureResponderEvent,type LayoutChangeEvent} from 'react-native';
import {signatureHasInk,type SavedSignature,type SignaturePoint} from '@fireops/domain';
import {AppSymbol} from '@/components/app-symbol';
import {type FireOpsTheme,useFireOpsTheme} from '@/theme';

export function SignaturePad({value,onChange,onSigningChange,label}:{value?:SavedSignature;onChange:(value:SavedSignature)=>void;onSigningChange?:(signing:boolean)=>void;label:string}){
  const theme=useFireOpsTheme();const styles=useMemo(()=>createStyles(theme),[theme]);const [strokes,setStrokes]=useState<SignaturePoint[][]>(value?.strokes??[]);const [size,setSize]=useState({width:1,height:1});
  useEffect(()=>setStrokes(value?.strokes??[]),[value]);
  const point=(event:GestureResponderEvent):SignaturePoint=>({x:Math.max(0,Math.min(1,event.nativeEvent.locationX/size.width)),y:Math.max(0,Math.min(1,event.nativeEvent.locationY/size.height))});
  const start=(event:GestureResponderEvent)=>{onSigningChange?.(true);const nextPoint=point(event);setStrokes(items=>[...items,[nextPoint]])};
  const move=(event:GestureResponderEvent)=>{const nextPoint=point(event);setStrokes(items=>items.map((stroke,index)=>index===items.length-1?[...stroke,nextPoint]:stroke))};
  const finish=()=>{onSigningChange?.(false);onChange({strokes:strokes.filter(stroke=>stroke.length>1)})};
  const layout=(event:LayoutChangeEvent)=>setSize(event.nativeEvent.layout);
  const clear=()=>{setStrokes([]);onChange({strokes:[]})};
  return <View style={styles.wrapper}><View style={styles.heading}><Text style={styles.label}>{label}</Text>{signatureHasInk({strokes})?<Pressable onPress={clear} style={styles.clear}><AppSymbol name="arrow.counterclockwise" color={theme.danger} size={14}/><Text style={styles.clearText}>Clear</Text></Pressable>:null}</View><View accessibilityLabel={`${label} drawing area`} onLayout={layout} onStartShouldSetResponder={()=>true} onStartShouldSetResponderCapture={()=>true} onMoveShouldSetResponder={()=>true} onMoveShouldSetResponderCapture={()=>true} onResponderGrant={start} onResponderMove={move} onResponderRelease={finish} onResponderTerminate={finish} style={styles.pad}>{strokes.flatMap((stroke,strokeIndex)=>stroke.slice(1).map((end,index)=>{const begin=stroke[index];const dx=(end.x-begin.x)*size.width,dy=(end.y-begin.y)*size.height,length=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx);return <View key={`${strokeIndex}-${index}`} style={[styles.line,{left:begin.x*size.width,top:begin.y*size.height,width:length,transform:[{rotateZ:`${angle}rad`}]}]}/>}))}</View><Text style={styles.hint}>Sign with finger.</Text></View>;
}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({wrapper:{gap:7},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},label:{color:theme.ink,fontSize:13,fontWeight:'800'},clear:{flexDirection:'row',alignItems:'center',gap:4,paddingVertical:4},clearText:{color:theme.danger,fontSize:11,fontWeight:'700'},pad:{height:130,overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:'#fff'},line:{position:'absolute',height:2.2,backgroundColor:'#17201b',transformOrigin:'left center'},hint:{color:theme.secondary,fontSize:11}})}
