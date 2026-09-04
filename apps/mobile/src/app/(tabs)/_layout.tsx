import {Redirect,Tabs} from 'expo-router';
import {isThreadUnread} from '@fireops/domain';
import type {ColorValue} from 'react-native';
import {AppSymbol} from '@/components/app-symbol';
import {useCommunications} from '@/lib/communications-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function TabLayout(){
  const theme=useFireOpsTheme();const {session,access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const {threads}=useCommunications(member?.company.id??null,member?.user.id??null);
  const unreadCommunications=member?threads.filter(thread=>isThreadUnread(thread,member.user)).length:0;
  if(!session||access.status!=='ready'||access.value?.kind!=='member')return <Redirect href="/"/>;
  const icon=(ios:string,android:string)=>function TabIcon(props:{color:ColorValue}){return <AppSymbol name={{ios:ios as never,android:android as never}} color={props.color}/>};
  return <Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:theme.ember,tabBarInactiveTintColor:theme.secondary,tabBarStyle:{backgroundColor:theme.paper,borderTopColor:theme.divider},tabBarLabelStyle:{fontSize:11,fontWeight:'700'}}}>
    <Tabs.Screen name="index" options={{title:'Dashboard',tabBarIcon:icon('rectangle.grid.1x2.fill','dashboard')}}/>
    <Tabs.Screen name="operations" options={{title:'Operations',tabBarIcon:icon('flame.fill','local_fire_department')}}/>
    <Tabs.Screen name="fleet" options={{title:'Fleet',tabBarIcon:icon('truck.box.fill','local_shipping')}}/>
    <Tabs.Screen name="communications" options={{title:'Comms',tabBarBadge:unreadCommunications||undefined,tabBarIcon:icon('bubble.left.and.bubble.right.fill','forum')}}/>
    <Tabs.Screen name="more" options={{title:'More',tabBarIcon:icon('ellipsis','more_horiz')}}/>
  </Tabs>;
}
