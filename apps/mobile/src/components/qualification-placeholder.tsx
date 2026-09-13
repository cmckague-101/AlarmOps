import {Redirect,Stack} from 'expo-router';
import {View} from 'react-native';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export function QualificationPlaceholder({title}:{title:string}){
  const {session,access}=useSession();
  const theme=useFireOpsTheme();
  if(!session||access.status==='error')return <Redirect href="/"/>;
  return <><Stack.Screen options={{title}}/><View style={{flex:1,backgroundColor:theme.canvas}}/></>;
}
