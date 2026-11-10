import {useMemo} from 'react';
import {Redirect,Stack,useRouter} from 'expo-router';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {viprIntelligenceEntries,type ViprIntelligenceEntryId} from '@fireops/domain';

import {AccentRail,pressedTileStyle,useReduceMotion,withAlpha} from '@/components/accent-tile';
import {AppSymbol} from '@/components/app-symbol';
import {SectionScreen} from '@/components/section-screen';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

// Same accents and destinations as web's VIPR Intelligence page.
const entryStyle:Record<ViprIntelligenceEntryId,{path:string;ios:string;android:string;color:string}>={
  'send-to-vipr':{path:'/send-to-vipr',ios:'square.and.arrow.up',android:'upload',color:'#2F6A8F'},
  'vipr-dpls':{path:'/dispatch-lists',ios:'list.number',android:'format_list_numbered',color:'#C94321'},
};

/** VIPR Intelligence hub: Send to VIPR (owners and admins) and VIPR DPLs (everyone). Back returns here from either. */
export default function ViprIntelligenceScreen(){
  const router=useRouter();
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const reduceMotion=useReduceMotion();
  const {session,access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;

  if(!session||access.status==='error')return <Redirect href="/"/>;
  if(access.status==='idle'||access.status==='loading')return <SectionScreen title="VIPR Intelligence" description="Checking access…"/>;
  if(!member)return <Redirect href="/"/>;

  return <>
    <Stack.Screen options={{title:'VIPR Intelligence'}}/>
    <SectionScreen title="VIPR Intelligence" description="VIPR tools for your fleet and the USFS dispatch priority lists.">
      <View style={styles.list}>{viprIntelligenceEntries(member.user.role).map(entry=>{
        const {path,ios,android,color}=entryStyle[entry.id];
        return <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={entry.label} accessibilityHint={entry.description} onPress={()=>router.push(path as never)} style={({pressed})=>[styles.entry,{borderColor:withAlpha(color,.35)},pressedTileStyle(color,{pressed,reduceMotion,scale:.98})]}>
          <AccentRail color={color}/>
          <View style={[styles.icon,{backgroundColor:color}]}><AppSymbol name={{ios,android} as never} size={22} color="#FFFFFF"/></View>
          <View style={styles.copy}><Text style={styles.label}>{entry.label}</Text><Text style={styles.description}>{entry.description}</Text></View>
          <AppSymbol name={{ios:'chevron.right',android:'chevron_right'} as never} size={16} color={theme.secondary}/>
        </Pressable>;
      })}</View>
    </SectionScreen>
  </>;
}

function createStyles(theme:FireOpsTheme){
  return StyleSheet.create({
    list:{gap:12},
    entry:{flexDirection:'row',alignItems:'center',gap:14,minHeight:84,padding:16,overflow:'hidden',borderRadius:16,borderWidth:1,backgroundColor:theme.paper},
    icon:{width:46,height:46,alignItems:'center',justifyContent:'center',borderRadius:12},
    copy:{flex:1,gap:4},
    label:{color:theme.ink,fontSize:16,fontWeight:'800'},
    description:{color:theme.secondary,fontSize:14,lineHeight:19},
  });
}
