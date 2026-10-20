import {isCompanyManager} from '@fireops/domain';
import {Stack} from 'expo-router';
import {useEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {SectionScreen} from '@/components/section-screen';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

type AuditEntry={id:string;created_at:string;actor_name:string;description:string};
const pageSize=100;
export default function AuditLogScreen(){
  const theme=useFireOpsTheme();
  const {access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const allowed=!!member&&isCompanyManager(member.user.role);
  const companyId=allowed?member?.company.id:null;
  const [entries,setEntries]=useState<AuditEntry[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [page,setPage]=useState(0);
  const [reload,setReload]=useState(0);
  const newestAt=useRef<string|null>(null);
  useEffect(()=>{setEntries([]);setPage(0);},[companyId]);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    if(page===0)setEntries([]);
    const load=async()=>{
      if(!companyId||!supabase){setLoading(false);setHasMore(false);return;}
      let query=supabase.from('company_audit_log').select('id,created_at,actor_name,description')
        .eq('company_id',companyId).gte('created_at',new Date(Date.now()-30*86400000).toISOString())
        .order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*pageSize,(page+1)*pageSize-1);
      // Keep later pages stable when new activity arrives before a refresh.
      if(page>0&&newestAt.current)query=query.lte('created_at',newestAt.current);
      const {data,error}=await query;
      if(!active)return;
      if(!error&&page===0)newestAt.current=data?.[0]?.created_at??null;
      if(error)setError(error.message);
      else{setEntries(previous=>page===0?(data??[]):[...previous,...(data??[])]);setHasMore(data?.length===pageSize);}
      setLoading(false);
    };
    void load().catch(error=>{if(active){setError(error instanceof Error?error.message:'Audit log could not be loaded.');setLoading(false);}});
    return()=>{active=false;};
  },[companyId,page,reload]);
  const button=(label:string,onPress:()=>void)=><Pressable accessibilityRole="button" disabled={loading} onPress={onPress} style={[styles.button,{borderColor:theme.divider},loading&&{opacity:0.5}]}><Text style={{color:theme.ink,fontWeight:'700'}}>{label}</Text></Pressable>;
  return <SectionScreen title="Audit log" description="Company activity from the last 30 days. Latest first.">
    <Stack.Screen options={{title:'Audit log'}}/>
    {!allowed?<Text style={{color:theme.secondary}}>Only owners and admins can view the audit log.</Text>:<>
      {button('Refresh',()=>{setPage(0);setReload(value=>value+1);})}
      {error?<View accessibilityRole="alert"><Text style={{color:theme.danger}}>{error}</Text>{button('Retry',()=>setReload(value=>value+1))}</View>:null}
      {entries.map(entry=><View key={entry.id} style={[styles.entry,{borderBottomColor:theme.divider}]}>
        <Text style={[styles.date,{color:theme.secondary}]}>{new Date(entry.created_at).toLocaleString()}</Text>
        <Text style={[styles.name,{color:theme.ink}]}>{entry.actor_name}</Text>
        <Text style={[styles.description,{color:theme.ink}]}>{entry.description}</Text>
      </View>)}
      {loading?<Text style={{color:theme.secondary}}>Loading audit log…</Text>:null}
      {!loading&&!error&&entries.length===0?<Text style={{color:theme.secondary}}>No activity in the last 30 days.</Text>:null}
      {hasMore&&!loading&&!error?button('Load more',()=>setPage(value=>value+1)):null}
    </>}
  </SectionScreen>;
}
const styles=StyleSheet.create({
  entry:{paddingVertical:16,borderBottomWidth:1,gap:6},
  date:{fontSize:13},name:{fontSize:16,fontWeight:'700'},description:{fontSize:15,lineHeight:22},
  button:{alignSelf:'flex-start',borderWidth:1,borderRadius:8,paddingHorizontal:16,paddingVertical:12,marginVertical:12},
});
