import {isDocumentUnread,isTrainingUnread} from '@fireops/domain';
import {useRouter} from 'expo-router';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {AppSymbol} from '@/components/app-symbol';
import {SectionScreen} from '@/components/section-screen';
import {useCompanyDocuments} from '@/lib/documents-store';
import {useTrainings} from '@/lib/training-store';
import {useNotificationInbox} from '@/lib/notification-inbox-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

const sections=['Notifications','Documents','Receipts','Invoices','Payroll','Availability','Training','Crew','Inventory','Settings'];
export default function More(){
  const router=useRouter();const theme=useFireOpsTheme();const {access,signOut}=useSession();const member=access.value?.kind==='member'?access.value:null;
  const {documents}=useCompanyDocuments(member?.company.id??null,member?.user.id??null);
  const {trainings}=useTrainings(member?.company.id??null,member?.user.id??null);
  const {unreadCount:unreadNotifications}=useNotificationInbox(member?.company.id??null,member?.user.id??null);
  const unreadDocuments=member?documents.filter(document=>isDocumentUnread(document,member.user)).length:0;
  const unreadTrainings=member?trainings.filter(training=>isTrainingUnread(training,member.user)).length:0;
  const visible=sections.filter(item=>member?.user.role==='owner'||!['Crew'].includes(item));
  return <SectionScreen title="More" description="Notifications, documents, training, and account settings">
    <View style={[styles.list,{backgroundColor:theme.paper,borderColor:theme.divider}]}>{visible.map((item,index)=>['Notifications','Documents','Receipts','Invoices','Payroll','Availability','Training','Crew','Inventory','Settings'].includes(item)?<Pressable accessibilityRole="button" key={item} onPress={()=>router.push((item==='Notifications'?'/notifications':item==='Documents'?'/documents':item==='Receipts'?'/receipts':item==='Invoices'?'/invoices':item==='Payroll'?'/payroll':item==='Availability'?'/availability':item==='Training'?'/training':item==='Crew'?'/crew':item==='Inventory'?'/inventory':'/settings') as never)} style={({pressed})=>[styles.row,index>0&&{borderTopWidth:1,borderTopColor:theme.divider},pressed&&styles.pressed]}><Text style={[styles.rowLabel,{color:theme.ink}]}>{item}</Text>{['Notifications','Documents','Training'].includes(item)&&(item==='Notifications'?unreadNotifications:item==='Documents'?unreadDocuments:unreadTrainings)>0&&<Text style={[styles.badge,{color:theme.ember,backgroundColor:theme.dangerSurface}]}>{item==='Notifications'?unreadNotifications:item==='Documents'?unreadDocuments:unreadTrainings} new</Text>}<AppSymbol name={{ios:'chevron.right',android:'chevron_right'} as never} color={theme.secondary} size={17}/></Pressable>:<View key={item} style={[styles.row,index>0&&{borderTopWidth:1,borderTopColor:theme.divider}]}><Text style={[styles.rowLabel,{color:theme.ink}]}>{item}</Text><Text style={[styles.pending,{color:theme.secondary}]}>Coming next</Text></View>)}</View>
    <Pressable accessibilityRole="button" onPress={()=>void signOut()} style={[styles.signOut,{borderColor:theme.divider}]}><Text style={[styles.signOutLabel,{color:theme.danger}]}>Sign out</Text></Pressable>
  </SectionScreen>;
}
const styles=StyleSheet.create({list:{borderWidth:1,borderRadius:12,overflow:'hidden'},row:{minHeight:54,paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:10},rowLabel:{fontSize:16,fontWeight:'600',flex:1},pending:{fontSize:13},badge:{overflow:'hidden',borderRadius:999,paddingHorizontal:8,paddingVertical:4,fontSize:11,fontWeight:'800'},signOut:{minHeight:50,borderWidth:1,borderRadius:9,alignItems:'center',justifyContent:'center',marginTop:24},signOutLabel:{fontSize:16,fontWeight:'700'},pressed:{opacity:0.65}});
