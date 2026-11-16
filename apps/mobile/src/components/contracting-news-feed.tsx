import {useCallback,useEffect,useMemo,useState} from 'react';
import {createDemoContractingNewsFeed,type ContractingNewsFeed} from '@fireops/domain';
import {Linking,Pressable,StyleSheet,Text,View} from 'react-native';
import {AppSymbol} from './app-symbol';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {type FireOpsTheme,useFireOpsTheme} from '@/theme';

function opportunityDetail(item:ContractingNewsFeed['opportunities'][number]){
  if(item.matchedFleetCategories.length)return `${item.matchedFleetCategories.join(' / ')} matched to your Fleet`;
  return item.agency;
}

export function ContractingNewsFeedSection(){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {access,demoMode}=useSession();
  const companyId=access.value?.kind==='member'?access.value.company.id:null;
  const [feed,setFeed]=useState<ContractingNewsFeed|null>(()=>demoMode?createDemoContractingNewsFeed():null);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(!demoMode);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      if(demoMode){setFeed(createDemoContractingNewsFeed());return}
      if(!companyId)throw new Error('Company is not available.');
      if(!supabase)throw new Error('FireOps data service is not configured.');
      const {data,error:failure}=await supabase.functions.invoke<ContractingNewsFeed>('news-feed',{body:{companyId}});
      if(failure)throw failure;
      if(!data)throw new Error('SAM.gov returned no news feed data.');
      setFeed(data);
    }catch(failure){setError((failure as {message?:string}).message??'Contracting opportunities could not be loaded.');}
    finally{setLoading(false)}
  },[companyId,demoMode]);
  useEffect(()=>{void load()},[load]);
  const count=feed?.opportunities.length??0;
  return <View style={styles.panel}>
    <View style={styles.heading}>
      <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(value=>!value)} style={({pressed})=>[styles.toggle,pressed&&styles.pressed]}>
        <View style={styles.icon}><AppSymbol name={{ios:'star',android:'star'} as never} color="#fff" size={21}/></View>
        <View style={styles.headingCopy}><Text style={styles.title}>{loading&&!feed?'Checking contracting alerts…':`${count} contracting ${count===1?'alert':'alerts'}`}</Text><Text style={styles.subtitle}>{demoMode?'Demo samples · matched to your Fleet categories':'Live SAM.gov notices matched to your Fleet categories'}</Text></View>
        <View style={open?styles.chevronOpen:undefined}><AppSymbol name={{ios:'chevron.down',android:'expand_more'} as never} color={theme.secondary} size={18}/></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh contracting alerts" onPress={()=>void load()} disabled={loading} style={({pressed})=>[styles.refresh,pressed&&styles.pressed]}><AppSymbol name={{ios:'arrow.clockwise',android:'refresh'} as never} color={theme.ember} size={18}/></Pressable>
    </View>
    {open?error?<View style={styles.state}><View style={styles.stateCopy}><Text accessibilityRole="alert" style={styles.stateTitle}>Contracting feed unavailable</Text><Text style={styles.stateText}>{error}</Text></View><Pressable accessibilityRole="button" onPress={()=>void load()}><Text style={styles.retry}>Try again</Text></Pressable></View>:feed&&!count?<View style={styles.state}><View style={styles.stateCopy}><Text style={styles.stateTitle}>No matching opportunities</Text><Text style={styles.stateText}>No active Forest Service notices match your current Fleet.</Text></View></View>:feed?.opportunities.map(item=><Pressable key={item.id} accessibilityRole={demoMode?'text':'link'} disabled={demoMode} onPress={()=>void Linking.openURL(item.sourceUrl)} style={({pressed})=>[styles.row,pressed&&styles.pressed]}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.rowDetail}>{opportunityDetail(item)}</Text></View><AppSymbol name={{ios:'chevron.right',android:'chevron_right'} as never} color={theme.secondary} size={18}/></Pressable>):null}
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  panel:{overflow:'hidden',marginBottom:20,borderWidth:1,borderColor:theme.blue,borderRadius:14,backgroundColor:theme.blueSurface},heading:{flexDirection:'row',alignItems:'stretch'},toggle:{minWidth:0,flex:1,flexDirection:'row',alignItems:'center',gap:11,padding:14},icon:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:11,backgroundColor:theme.blue},headingCopy:{minWidth:0,flex:1},title:{color:theme.ink,fontSize:14,fontWeight:'800'},subtitle:{marginTop:4,color:theme.secondary,fontSize:11,lineHeight:15},chevronOpen:{transform:[{rotate:'180deg'}]},refresh:{width:46,alignItems:'center',justifyContent:'center',borderLeftWidth:StyleSheet.hairlineWidth,borderLeftColor:theme.divider},row:{minHeight:70,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,paddingHorizontal:16,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.divider},rowCopy:{minWidth:0,flex:1},rowTitle:{color:theme.ink,fontSize:14,lineHeight:19,fontWeight:'800'},rowDetail:{marginTop:4,color:theme.secondary,fontSize:12,lineHeight:17},state:{flexDirection:'row',alignItems:'center',gap:12,padding:16,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.divider},stateCopy:{minWidth:0,flex:1},stateTitle:{color:theme.ink,fontSize:14,fontWeight:'800'},stateText:{marginTop:4,color:theme.secondary,fontSize:12,lineHeight:17},retry:{color:theme.ember,fontSize:13,fontWeight:'800'},pressed:{opacity:.65}
});}
