import {canInspectVehicle,canManagePersonalTasks,canWorkShop,keepsInventoryInMainNav} from '@fireops/domain';
import {Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useRouter} from 'expo-router';
import {AppSymbol} from './app-symbol';
import {useSession} from '@/providers/session-provider';
import {useAvailability} from '@/lib/use-availability';
import {useTaskCount} from '@/lib/use-task-count';
import {useDashboardPreferences} from '@/lib/use-dashboard-preferences';
import type {DashboardItem,UserRole} from '@fireops/domain';
import {useFireOpsTheme,type FireOpsTheme} from '@/theme';

export function quickActionItems(role:UserRole,theme:FireOpsTheme):{item:DashboardItem;path:string;label:string;ios:string;android:string;color:string}[] {
  const manager=role==='owner'||role==='admin';
  return [
    {item:'availability',path:'/availability',label:'Availability',ios:'circle',android:'radio_button_unchecked',color:theme.green},
    ...(canManagePersonalTasks(role) ? [{item:'tasks' as const,path:'/tasks',label:'Task List',ios:'checklist',android:'checklist',color:'#7041b5'}] : []),
    ...(canInspectVehicle(role) && !manager ? [{item:'inspections' as const,path:'/inspection',label:'Inspect',ios:'checkmark.shield.fill',android:'verified_user',color:'#087e8b'}] : []),
    // Same set and order as web: Inventory and Failed Inspections moved to More, Receipts lives on More.
    ...(canWorkShop(role) ? [{item:'shop' as const,path:'/shop',label:'Shop',ios:'wrench.and.screwdriver.fill',android:'build',color:'#8A3418'}] : []),
    ...(keepsInventoryInMainNav(role) ? [{item:'inventory' as const,path:'/inventory',label:'Inventory',ios:'bag.fill',android:'shopping_bag',color:theme.warning}] : []),
    {item:'payroll',path:'/payroll',label:'Payroll',ios:'wallet.bifold.fill',android:'account_balance_wallet',color:'#285f9e'},
    {item:'invoices',path:'/invoices',label:'Invoices',ios:'doc.text.fill',android:'description',color:'#981d5c'},
  ];
}

export function QuickActions() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const {width,fontScale} = useWindowDimensions();
  const {access,demoMode} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const {visible}=useDashboardPreferences(member?.user.id,demoMode);
  const {statuses,loading,error} = useAvailability(member?.company.id,member?.user.id);
  const taskCount = useTaskCount(member&&canManagePersonalTasks(member.user.role)?member.company.id:undefined,member&&canManagePersonalTasks(member.user.role)?member.user.id:undefined);
  const status = member ? statuses[member.user.id] : undefined;
  const styles = StyleSheet.create({section:{gap:16},title:{fontSize:24,fontWeight:'800',color:theme.ink},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},card:{width:width<360||fontScale>1.3?'100%':'48%',flexGrow:1,alignItems:'center',justifyContent:'center',gap:8,padding:14,minHeight:118,borderRadius:16,borderWidth:1,borderColor:theme.divider,backgroundColor:theme.paper},fullCard:{width:'100%'},count:{position:'absolute',top:-9,right:-12,minWidth:26,minHeight:26,paddingHorizontal:6,paddingVertical:3,borderWidth:2,borderColor:theme.paper,borderRadius:20,backgroundColor:theme.danger,color:'#FFFFFF',textAlign:'center',fontSize:12,fontWeight:'800',fontVariant:['tabular-nums']},icon:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:12},label:{color:theme.ink,fontSize:15,fontWeight:'800',textAlign:'center'},status:{color:theme.secondary,fontSize:14,textAlign:'center'},pressed:{opacity:.65}});
  const actions = member ? quickActionItems(member.user.role,theme) : [];
  const visibleActions=actions.filter(action=>visible(action.item));
  if(!visibleActions.length)return null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Quick Actions</Text><View style={styles.grid}>{visibleActions.map(action=><Pressable key={action.path} accessibilityRole="button" onPress={()=>router.push(action.path as never)} style={({pressed})=>[styles.card,action.path==='/availability'&&styles.fullCard,pressed&&styles.pressed]}><View style={[styles.icon,{backgroundColor:action.color}]}><AppSymbol name={{ios:action.ios,android:action.android} as never} size={23} color="#FFFFFF"/>{action.path==='/tasks'&&!!taskCount&&<Text accessibilityLabel={`${taskCount} open tasks`} style={styles.count}>{taskCount}</Text>}</View><Text style={styles.label}>{action.label}</Text>{action.path==='/availability' && <Text style={styles.status}>{member?.user.role==='owner'||member?.user.role==='admin'?'Crew readiness':loading?'Loading…':error?'Status unavailable':status===undefined?'Not set':status?'Available':'Unavailable'}</Text>}</Pressable>)}</View></View>;
}
