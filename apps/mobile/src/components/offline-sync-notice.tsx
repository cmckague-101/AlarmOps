import {Pressable,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {offlineSyncNotice} from '../lib/offline-sync-worker';
import {useOfflineSync} from '../providers/offline-sync-provider';
import {useFireOpsTheme} from '../theme';

export function OfflineSyncNotice({topInset=0}:{topInset?:number}){
  const {state,available,dismiss}=useOfflineSync();const theme=useFireOpsTheme();
  const notice=available?offlineSyncNotice(state):null;if(!notice)return null;
  return <View accessibilityLiveRegion="polite" style={[styles.notice,{backgroundColor:theme.paper,borderColor:theme.divider,paddingTop:8+topInset}]}>
    <View style={styles.copy}><Text style={[styles.title,{color:theme.ink}]}>{notice.message}</Text>{notice.detail&&<Text style={{color:theme.secondary,fontSize:12}}>{notice.detail}</Text>}</View>
    <Pressable accessibilityRole="button" accessibilityLabel="Open saved changes and sync status" onPress={()=>router.push('/sync-status' as never)} style={styles.button}><Text style={{color:theme.ember,fontWeight:'700'}}>Details</Text></Pressable>
    {notice.dismissible&&<Pressable accessibilityRole="button" accessibilityLabel="Dismiss completed sync notices without deleting saved history" onPress={()=>void dismiss()} style={styles.button}><Text style={{color:theme.secondary,fontWeight:'700'}}>Dismiss</Text></Pressable>}
  </View>;
}
const styles=StyleSheet.create({notice:{paddingHorizontal:16,paddingVertical:8,borderBottomWidth:1,flexDirection:'row',alignItems:'center',gap:10},copy:{flex:1,gap:3},title:{fontSize:13,lineHeight:19,fontWeight:'700'},button:{minHeight:48,justifyContent:'center',paddingHorizontal:6}});
