import {Redirect,Tabs,usePathname} from 'expo-router';
import {isDocumentUnread,isThreadUnread,isTrainingUnread} from '@fireops/domain';
import {useWindowDimensions,type ColorValue} from 'react-native';
import {AppHeaderBrand,AppHeaderSectionTitle} from '@/components/app-header-brand';
import {AppSymbol} from '@/components/app-symbol';
import {useCommunications} from '@/lib/communications-store';
import {useCompanyDocuments} from '@/lib/documents-store';
import {useTrainings} from '@/lib/training-store';
import {useNotificationInbox} from '@/lib/notification-inbox-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function TabLayout(){
  const theme=useFireOpsTheme();const {session,access}=useSession();
  const {width,height}=useWindowDimensions();const pathname=usePathname();
  const isOperationsLandscape=pathname==='/operations'&&width>height;
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
  const sectionTitles:Record<string,string>={index:'Dashboard',operations:'Operations',fleet:'Fleet',communications:'Chat',more:'More'};
  return <Tabs screenOptions={({route})=>({headerShown:!isOperationsLandscape,headerTitleAlign:'left',headerTitle:()=> <AppHeaderBrand/>,headerRight:()=> <AppHeaderSectionTitle title={sectionTitles[route.name]??''}/>,headerStyle:{backgroundColor:theme.paper},headerShadowVisible:true,tabBarActiveTintColor:theme.ember,tabBarInactiveTintColor:theme.secondary,tabBarStyle:isOperationsLandscape?{display:'none'}:{backgroundColor:theme.paper,borderTopColor:theme.divider},tabBarLabelStyle:{fontSize:11,fontWeight:'700'}})}>
    <Tabs.Screen name="index" options={{title:'Dashboard',tabBarBadge:unreadNotifications||undefined,tabBarIcon:icon('rectangle.grid.1x2.fill','dashboard')}}/>
    <Tabs.Screen name="operations" options={{title:'Operations',tabBarIcon:icon('flame.fill','local_fire_department')}}/>
    <Tabs.Screen name="fleet" options={{title:'Fleet',tabBarIcon:icon('truck.box.fill','local_shipping')}}/>
    <Tabs.Screen name="communications" options={{title:'Chat',tabBarBadge:unreadCommunications||undefined,tabBarIcon:icon('bubble.left.and.bubble.right.fill','forum')}}/>
    <Tabs.Screen name="more" options={{title:'More',tabBarBadge:unreadDocuments+unreadTrainings||undefined,tabBarIcon:icon('ellipsis','more_horiz')}}/>
  </Tabs>;
}
