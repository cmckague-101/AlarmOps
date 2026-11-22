import {Redirect,Tabs,usePathname} from 'expo-router';
import {isDocumentUnread,isThreadUnread,isTrainingUnread} from '@fireops/domain';
import {useWindowDimensions,type ColorValue} from 'react-native';
import {useReduceMotion} from '@/components/accent-tile';
import {AppHeaderBrand} from '@/components/app-header-brand';
import {AppSymbol} from '@/components/app-symbol';
import {AssistantHost} from '@/components/assistant-panel';
import {ResourcesIcon} from '@/components/resources-icon';
import {isOperationsLandscape} from '@/lib/operations-layout';
import {useCommunications} from '@/lib/communications-store';
import {useCompanyDocuments} from '@/lib/documents-store';
import {useTrainings} from '@/lib/training-store';
import {useNotificationInbox} from '@/lib/notification-inbox-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function TabLayout(){
  const theme=useFireOpsTheme();const {session,access}=useSession();
  const {width,height}=useWindowDimensions();const pathname=usePathname();
  const reduceMotion=useReduceMotion();
  // Operations is the first tab ('/'); sideways it shows only the full-screen map.
  const operationsLandscape=pathname==='/'&&isOperationsLandscape(width,height);
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
  const resourcesTabIcon=({color,size}:{color:ColorValue;size:number})=> <ResourcesIcon color={String(color)} size={size}/>;
  // Horizontal tab shift (left/right by index). Keep inactive scenes attached so shift does not blank a tab.
  return <><Tabs detachInactiveScreens={false} screenOptions={()=>({animation:reduceMotion?'fade':'shift',headerShown:!operationsLandscape,headerTitleAlign:'center',headerTitle:()=> <AppHeaderBrand/>,headerStyle:{backgroundColor:theme.paper},headerShadowVisible:true,tabBarActiveTintColor:theme.ember,tabBarInactiveTintColor:theme.secondary,tabBarStyle:operationsLandscape?{display:'none'}:{backgroundColor:theme.paper,borderTopColor:theme.divider},tabBarLabelStyle:{fontSize:11,fontWeight:'700'}})}>
    <Tabs.Screen name="index" options={{title:'Operations',tabBarBadge:unreadNotifications||undefined,tabBarIcon:icon('flame.fill','local_fire_department')}}/>
    {/* Old /operations links and pushes redirect to the Operations tab (index). */}
    <Tabs.Screen name="operations" options={{href:null}}/>
    <Tabs.Screen name="fleet" options={{title:'Resources',tabBarIcon:resourcesTabIcon}}/>
    <Tabs.Screen name="communications" options={{title:'Communications',tabBarLabel:'Messages',tabBarBadge:unreadCommunications||undefined,tabBarIcon:icon('bubble.left.and.bubble.right.fill','forum')}}/>
    <Tabs.Screen name="more" options={{title:'Tools',tabBarBadge:unreadDocuments+unreadTrainings||undefined,tabBarIcon:icon('square.grid.2x2.fill','apps')}}/>
  </Tabs>{operationsLandscape?null:<AssistantHost/>}</>;
}
