import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {useFireOpsTheme} from '@/theme';

type Props={title:string;message?:string;busy?:boolean;actionLabel?:string;onAction?:()=>void;secondaryLabel?:string;onSecondary?:()=>void};
export function ScreenState({title,message,busy=false,actionLabel,onAction,secondaryLabel,onSecondary}:Props){
  const theme=useFireOpsTheme();
  return <View style={[styles.screen,{backgroundColor:theme.canvas}]}>
    <View style={styles.content}>
      {busy&&<ActivityIndicator color={theme.ember} size="large"/>}
      <Text accessibilityRole="header" style={[styles.title,{color:theme.ink}]}>{title}</Text>
      {message&&<Text style={[styles.message,{color:theme.secondary}]}>{message}</Text>}
      {actionLabel&&<Pressable accessibilityRole="button" onPress={onAction} style={({pressed})=>[styles.primary,{backgroundColor:pressed?theme.emberPressed:theme.ember}]}><Text style={styles.primaryLabel}>{actionLabel}</Text></Pressable>}
      {secondaryLabel&&<Pressable accessibilityRole="button" onPress={onSecondary} style={styles.secondary}><Text style={[styles.secondaryLabel,{color:theme.ember}]}>{secondaryLabel}</Text></Pressable>}
    </View>
  </View>;
}
const styles=StyleSheet.create({
  screen:{flex:1,justifyContent:'center',padding:24},content:{alignItems:'center',gap:12},
  title:{fontSize:24,fontWeight:'800',textAlign:'center'},message:{fontSize:16,lineHeight:23,textAlign:'center',maxWidth:420},
  primary:{minHeight:48,minWidth:180,marginTop:8,paddingHorizontal:18,borderRadius:9,alignItems:'center',justifyContent:'center'},
  primaryLabel:{color:'#FFFFFF',fontSize:16,fontWeight:'700'},secondary:{minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},secondaryLabel:{fontSize:16,fontWeight:'700'},
});
