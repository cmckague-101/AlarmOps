import {Redirect,Stack} from 'expo-router';

import {ContractingNewsFeedSection} from '@/components/contracting-news-feed';
import {NationalFireActivitySection} from '@/components/national-fire-activity';
import {NewsFeedMetrics} from '@/components/news-feed-metrics';
import {NewsFeedStories} from '@/components/news-feed-stories';
import {SectionScreen} from '@/components/section-screen';
import {useSession} from '@/providers/session-provider';

export default function NewsFeedScreen(){
  const {session,access,demoMode}=useSession();
  if((!session&&!demoMode)||access.status==='error')return <Redirect href="/"/>;
  return <>
    <Stack.Screen options={{title:'News Feed'}}/>
    <SectionScreen title="News Feed">
      <NewsFeedMetrics/>
      <NewsFeedStories contracting={<ContractingNewsFeedSection/>}/>
      <NationalFireActivitySection/>
    </SectionScreen>
  </>;
}
