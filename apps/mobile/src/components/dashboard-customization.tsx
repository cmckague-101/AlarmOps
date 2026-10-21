import {dashboardPreferenceGroups} from '@fireops/domain';
import {Pressable,StyleSheet,Switch,Text,View} from 'react-native';
import {useRouter} from 'expo-router';
import {useDashboardPreferences} from '@/lib/use-dashboard-preferences';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export function CustomizeDashboardButton(){
  const router=useRouter();const theme=useFireOpsTheme();
  return <Pressable accessibilityRole="button" onPress={()=>router.push({pathname:'/settings',params:{section:'dashboard'}} as never)} style={({pressed})=>({minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:theme.divider,borderRadius:12,opacity:pressed ? .65 : 1})}><Text style={{color:theme.ink,fontSize:16,fontWeight:'700'}}>Customize Dashboard</Text></Pressable>;
}
export function DashboardCustomization(){
  const {access,demoMode}=useSession();const theme=useFireOpsTheme();
  const user=access.value?.kind==='member'?access.value.user:null;
  const {visible,save,loading,saving,error,loadFailed,reload}=useDashboardPreferences(user?.id,demoMode);
  const styles=StyleSheet.create({panel:{padding:20,gap:20,borderRadius:16,borderWidth:1,borderColor:theme.divider,backgroundColor:theme.paper},title:{fontSize:24,fontWeight:'800',color:theme.ink},heading:{fontSize:18,fontWeight:'700',color:theme.ink},copy:{fontSize:15,lineHeight:22,color:theme.secondary},row:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:16},label:{flex:1,fontSize:16,color:theme.ink}});
  if(!user)return null;
  return <View style={styles.panel}><Text accessibilityRole="header" style={styles.title}>Customize Dashboard</Text><Text style={styles.copy}>Choose what appears on your dashboard. Changes save automatically for your account.</Text>{loading&&<Text style={styles.copy}>Loading dashboard preferences…</Text>}{dashboardPreferenceGroups(user.role,'mobile').map(group=><View key={group.title}><Text accessibilityRole="header" style={styles.heading}>{group.title}</Text>{group.items.map(item=><View key={item.id} style={styles.row}><Text style={styles.label}>{item.label}</Text><Switch accessibilityLabel={item.label} disabled={loading||saving||loadFailed} value={visible(item.id)} onValueChange={value=>void save(item.id,value)} trackColor={{true:theme.ember}}/></View>)}</View>)}{saving&&<Text style={styles.copy}>Saving…</Text>}{error&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>}{loadFailed&&<Pressable accessibilityRole="button" onPress={reload} style={styles.row}><Text style={styles.label}>Try again</Text></Pressable>}</View>;
}
