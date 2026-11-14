import {Redirect,Stack} from 'expo-router';

import {NationalFireActivitySection} from '@/components/national-fire-activity';
import {SectionScreen} from '@/components/section-screen';
import {useSession} from '@/providers/session-provider';

/** News Feed: National Fire Activity for now; more news sources come later. Matches web's News Feed page. */
export default function NewsFeedScreen(){
  const {session,access}=useSession();
  if(!session||access.status==='error')return <Redirect href="/"/>;
  return <>
    <Stack.Screen options={{title:'News Feed'}}/>
    <SectionScreen title="News Feed">
      <NationalFireActivitySection/>
    </SectionScreen>
  </>;
}
