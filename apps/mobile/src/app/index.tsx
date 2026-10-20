import {Redirect} from 'expo-router';
import {ScreenState} from '@/components/screen-state';
import {useSession} from '@/providers/session-provider';

export default function Index(){
  const {configured,loading,session,access,retryAccess,signOut}=useSession();
  if(!configured)return <Redirect href="/sign-in"/>;
  if(loading)return <ScreenState title="FireOps" message="Restoring secure session…" busy/>;
  if(!session)return <Redirect href="/sign-in"/>;
  if(access.status==='idle'||access.status==='loading')return <ScreenState title="Checking access" message="Confirming company membership…" busy/>;
  if(access.status==='error')return <ScreenState title="Access unavailable" message={access.error} actionLabel="Try again" onAction={retryAccess} secondaryLabel="Sign out" onSecondary={()=>void signOut()}/>;
  if(access.value?.kind==='admin')return <Redirect href="/companies"/>;
  return <Redirect href="/(tabs)"/>;
}
