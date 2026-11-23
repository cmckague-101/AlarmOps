import {Redirect,Tabs} from 'expo-router';
import {isDocumentUnread,isThreadUnread,isTrainingUnread} from '@fireops/domain';
import {type ColorValue} from 'react-native';
import {useReduceMotion} from '@/components/accent-tile';
import {AppHeaderBrand} from '@/components/app-header-brand';
import {AppSymbol} from '@/components/app-symbol';
import {AssistantHost} from '@/components/assistant-panel';
import {FleetIcon} from '@/components/fleet-icon';
import {useCommunications} from '@/lib/communications-store';
import {useCompanyDocuments} from '@/lib/documents-store';
import {useTrainings} from '@/lib/training-store';
import {useNotificationInbox} from '@/lib/notification-inbox-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function TabLayout(){
  const theme=useFireOpsTheme();const {session,access}=useSession();
  const reduceMotion=useReduceMotion();
  const member=access.value?.kind==='member'?access.value:null;
  const {threads}=useCommunications(member?.company.id??null,member?.user.id??null);
  const {documents}=useCompanyDocuments(member?.company.id??null,member?.user.id??null);
  const {trainings}=useTrainings(member?.company.id??null,member?.user.id??null);
  const {unreadCount:unreadNotifications}=useNotificationInbox(member?.company.id??null,member?.user.id??null,member?.user.role??null);
  const unreadCommunications=member?threads.filter(thread=>isThreadUnread(thread,member.user)).length:0;
  const unreadDocuments=member?documents.filter(document=>isDocumentUnread(document,member.user)).length:0;
  const unreadTrainings=member?trainings.filter(training=>isTrainingUnread(training,member.user)).length:0;
  if(!session)return <Redirect href="/sign-in"/>;
  if(access.status!=='ready'||access.value?.kind!=='member')return <Redirect href="/"/>;
  const icon=(ios:string,android:string)=>function TabIcon(props:{color:ColorValue}){return <AppSymbol name={{ios:ios as never,android:android as never}} color={props.color}/>};
  const fleetTabIcon=({color,size}:{color:ColorValue;size:number})=> <FleetIcon color={String(color)} size={size}/>;
  // Horizontal tab shift (left/right by index). Keep inactive scenes attached so shift does not blank a tab.
  return <><Tabs detachInactiveScreens={false} screenOptions={()=>({animation:reduceMotion?'fade':'shift',headerShown:true,headerTitleAlign:'center',headerTitle:()=> <AppHeaderBrand/>,headerStyle:{backgroundColor:theme.paper},headerShadowVisible:true,tabBarActiveTintColor:theme.ember,tabBarInactiveTintColor:theme.secondary,tabBarStyle:{backgroundColor:theme.paper,borderTopColor:theme.divider},tabBarLabelStyle:{fontSize:11,fontWeight:'700'}})}>
    <Tabs.Screen name="index" options={{title:'Command',tabBarBadge:unreadNotifications||undefined,tabBarIcon:icon('bell.badge.fill','notifications_active')}}/>
    {/* Old /operations links and pushes redirect to the home tab. */}
    <Tabs.Screen name="operations" options={{href:null}}/>
    <Tabs.Screen name="customers" options={{title:'Customers',tabBarIcon:icon('building.2.fill','apartment')}}/>
    <Tabs.Screen name="jobs" options={{title:'Jobs',tabBarIcon:icon('wrench.and.screwdriver.fill','construction')}}/>
    <Tabs.Screen name="fleet" options={{title:'Fleet',tabBarIcon:fleetTabIcon}}/>
    <Tabs.Screen name="communications" options={{title:'Communications',href:null,tabBarLabel:'Messages',tabBarBadge:unreadCommunications||undefined,tabBarIcon:icon('bubble.left.and.bubble.right.fill','forum')}}/>
    <Tabs.Screen name="more" options={{title:'Tools',tabBarBadge:unreadDocuments+unreadCommunications+unreadTrainings||undefined,tabBarIcon:icon('square.grid.2x2.fill','apps')}}/>
  </Tabs><AssistantHost/></>;
}
