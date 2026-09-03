import {Pressable,StyleSheet,Text,View} from 'react-native';
import {SectionScreen} from '@/components/section-screen';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

const sections=['Documents','Training','Crew','Inventory','Settings'];
export default function More(){
  const theme=useFireOpsTheme();const {access,signOut}=useSession();const member=access.value?.kind==='member'?access.value:null;
  const visible=sections.filter(item=>member?.user.role==='owner'||!['Crew','Inventory'].includes(item));
  return <SectionScreen title="More" description="Documents, training, and account settings">
    <View style={[styles.list,{backgroundColor:theme.paper,borderColor:theme.divider}]}>{visible.map((item,index)=><View key={item} style={[styles.row,index>0&&{borderTopWidth:1,borderTopColor:theme.divider}]}><Text style={[styles.rowLabel,{color:theme.ink}]}>{item}</Text><Text style={[styles.pending,{color:theme.secondary}]}>Coming next</Text></View>)}</View>
    <Pressable accessibilityRole="button" onPress={()=>void signOut()} style={[styles.signOut,{borderColor:theme.divider}]}><Text style={[styles.signOutLabel,{color:theme.danger}]}>Sign out</Text></Pressable>
  </SectionScreen>;
}
const styles=StyleSheet.create({list:{borderWidth:1,borderRadius:12,overflow:'hidden'},row:{minHeight:54,paddingHorizontal:16,flexDirection:'row',alignItems:'center'},rowLabel:{fontSize:16,fontWeight:'600',flex:1},pending:{fontSize:13},signOut:{minHeight:50,borderWidth:1,borderRadius:9,alignItems:'center',justifyContent:'center',marginTop:24},signOutLabel:{fontSize:16,fontWeight:'700'}});
