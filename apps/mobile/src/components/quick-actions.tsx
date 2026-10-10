import {Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useRouter} from 'expo-router';
import {AppSymbol} from './app-symbol';
import {useSession} from '@/providers/session-provider';
import {useAvailability} from '@/lib/use-availability';
import {useFireOpsTheme} from '@/theme';

export function QuickActions() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const {width,fontScale} = useWindowDimensions();
  const {access} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const {statuses,loading,error} = useAvailability(member?.company.id);
  const status = member ? statuses[member.user.id] : undefined;
  const styles = StyleSheet.create({section:{gap:16},title:{fontSize:24,fontWeight:'800',color:theme.ink},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},card:{width:width<360||fontScale>1.3?'100%':'48%',flexGrow:1,alignItems:'center',justifyContent:'center',gap:10,padding:20,minHeight:170,borderRadius:16,borderWidth:1,borderColor:theme.divider,backgroundColor:theme.paper},fullCard:{width:'100%'},icon:{width:52,height:52,alignItems:'center',justifyContent:'center',borderRadius:14},label:{color:theme.ink,fontSize:16,fontWeight:'800',textAlign:'center'},status:{color:theme.secondary,fontSize:14,textAlign:'center'},pressed:{opacity:.65}});
  const actions = [
    {path:'/availability',label:'Availability',ios:'circle',android:'radio_button_unchecked',color:theme.green},
    ...(member?.user.role !== 'owner' && member?.user.role !== 'admin' ? [{path:'/inspection',label:'Inspect',ios:'list.bullet.clipboard.fill',android:'fact_check',color:theme.green}] : []),
    ...(member?.user.role === 'owner' || member?.user.role === 'admin' ? [{path:'/inspections',label:'Inspections',ios:'list.bullet.clipboard.fill',android:'fact_check',color:theme.green}] : []),
    {path:'/inventory',label:'Check Out Gear',ios:'bag.fill',android:'shopping_bag',color:theme.warning},
    {path:'/payroll',label:'Payroll',ios:'wallet.bifold.fill',android:'account_balance_wallet',color:'#285f9e'},
    {path:'/receipts',label:'Receipts',ios:'receipt',android:'receipt_long',color:theme.ember},
    {path:'/invoices',label:'Invoices',ios:'doc.text.fill',android:'description',color:'#981d5c'},
  ];
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Quick Actions</Text><View style={styles.grid}>{actions.map(action=><Pressable key={action.path} accessibilityRole="button" onPress={()=>router.push(action.path as never)} style={({pressed})=>[styles.card,action.path==='/availability'&&styles.fullCard,pressed&&styles.pressed]}><View style={[styles.icon,{backgroundColor:action.color}]}><AppSymbol name={{ios:action.ios,android:action.android} as never} size={27} color="#FFFFFF"/></View><Text style={styles.label}>{action.label}</Text>{action.path==='/availability' && <Text style={styles.status}>{member?.user.role==='owner'||member?.user.role==='admin'?'Crew readiness':loading?'Loading…':error?'Status unavailable':status===undefined?'Not set':status?'Available':'Unavailable'}</Text>}</Pressable>)}</View></View>;
}
