import {useMemo} from 'react';
import {Pressable,ScrollView,StyleSheet,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Stack,useLocalSearchParams,useRouter} from 'expo-router';
import type {SyncReviewTarget} from '@fireops/domain';
import {useSyncConflictReview} from '@/lib/use-sync-conflict-review';
import {SyncDeviceHistory} from '../components/sync-device-history';
import {useFireOpsTheme} from '@/theme';

// Device edit history for one vehicle or issue (owners/admins). Conflicts are no longer
// approved here: the person who made an offline change resolves it from the sync banner.
export default function SyncConflictScreen(){
  const theme=useFireOpsTheme();const router=useRouter();
  const params=useLocalSearchParams<{entityType?:string;entityId?:string}>();
  const {controller,allowed,offline,demoMode}=useSyncConflictReview();
  const target=useMemo<SyncReviewTarget|null>(()=>typeof params.entityId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.entityId)&&(params.entityType==='vehicle'||params.entityType==='issue')
    ?{entityId:params.entityId.toLowerCase(),entityType:params.entityType}:null,[params.entityId,params.entityType]);
  const styles=useMemo(()=>StyleSheet.create({
    safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:20},title:{fontSize:28,fontWeight:'800',color:theme.ink},
    meta:{fontSize:14,lineHeight:21,color:theme.secondary},error:{fontSize:15,lineHeight:22,color:theme.danger},
    button:{minHeight:48,alignItems:'center',justifyContent:'center',paddingHorizontal:16,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper},buttonText:{fontSize:16,fontWeight:'700',color:theme.ink},
  }),[theme]);
  const back=()=>{if(router.canGoBack())router.back();else router.replace('/(tabs)')};
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Device edit history'}}/>
    <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Text accessibilityRole="header" style={styles.title}>Device edit history</Text>
      {!allowed?<Text style={styles.meta}>{demoMode?'Device edit history is not available in demo mode.':'Only current company owners and admins can inspect device edit history.'}</Text>
        :!target?<Text style={styles.error}>This link is invalid.</Text>
        :<><Text style={styles.meta}>{target.entityType==='vehicle'?'Vehicle':'Issue'} · {target.entityId}</Text>
          <SyncDeviceHistory key={`${target.entityType}:${target.entityId}`} controller={controller.history} offline={offline}/></>}
      <Pressable accessibilityRole="button" onPress={back} style={styles.button}><Text style={styles.buttonText}>Back</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}
