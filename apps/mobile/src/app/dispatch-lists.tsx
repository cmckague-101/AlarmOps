import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Linking,Pressable,StyleSheet,Text,View} from 'react-native';
import {AppSymbol} from '@/components/app-symbol';
import {FilterSelect} from '@/components/filter-select';
import {SectionScreen} from '@/components/section-screen';
import {supabase} from '@/lib/supabase';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

type Area={id:number;name:string};
type Center={id:number;name:string};
type PriorityList={file_id:number;name:string;resource_type:string|null;published_at:string|null;sync_status:'complete'|'partial'};
type DispatchEntry={rank:number;company_name:string|null;equipment_location:string|null;vin:string|null;cafs:string|null;daily_rate:number|null;rate_status:'matched'|'not_found'|'ambiguous'};

const sourceUrl='https://www.fs.usda.gov/business/incident/vipr.php';
const failureMessage=(error:unknown)=>error instanceof Error?error.message:'Dispatch data could not be loaded.';

export default function DispatchListsScreen(){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const [areas,setAreas]=useState<Area[]>([]);
  const [centers,setCenters]=useState<Center[]>([]);
  const [lists,setLists]=useState<PriorityList[]>([]);
  const [entries,setEntries]=useState<DispatchEntry[]>([]);
  const [areaId,setAreaId]=useState('');
  const [centerId,setCenterId]=useState('');
  const [listId,setListId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);

  useEffect(()=>{
    let active=true;if(!supabase){setLoading(false);return}
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_geographic_areas').select('id,name').eq('is_active',true).order('name');
      if(!active)return;if(failure)throw failure;const next=(data??[]) as Area[];setAreas(next);setAreaId(current=>next.some(item=>String(item.id)===current)?current:String(next[0]?.id??''));
    }catch(failure){if(active)setError(failureMessage(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[refresh]);

  useEffect(()=>{
    let active=true;setCenters([]);setCenterId('');setLists([]);setListId('');setEntries([]);
    if(!supabase||!areaId)return()=>{active=false};setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_dispatch_centers').select('id,name').eq('geographic_area_id',Number(areaId)).eq('is_active',true).order('name');
      if(!active)return;if(failure)throw failure;const next=(data??[]) as Center[];setCenters(next);setCenterId(String(next[0]?.id??''));
    }catch(failure){if(active)setError(failureMessage(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[areaId,refresh]);

  useEffect(()=>{
    let active=true;setLists([]);setListId('');setEntries([]);
    if(!supabase||!centerId)return()=>{active=false};setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_priority_lists').select('file_id,name,resource_type,published_at,sync_status').eq('dispatch_center_id',Number(centerId)).eq('is_active',true).in('sync_status',['complete','partial']).order('published_at',{ascending:false});
      if(!active)return;if(failure)throw failure;const next=(data??[]) as PriorityList[];setLists(next);setListId(String(next[0]?.file_id??''));
    }catch(failure){if(active)setError(failureMessage(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[centerId,refresh]);

  useEffect(()=>{
    let active=true;setEntries([]);if(!supabase||!listId)return()=>{active=false};setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_dispatch_entries').select('rank,company_name,equipment_location,vin,cafs,daily_rate,rate_status').eq('priority_list_file_id',Number(listId)).order('rank');
      if(!active)return;if(failure)throw failure;setEntries((data??[]) as DispatchEntry[]);
    }catch(failure){if(active)setError(failureMessage(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[listId,refresh]);

  const selectedList=lists.find(item=>String(item.file_id)===listId);
  return <SectionScreen title="Dispatch Lists" description="USFS VIPR rankings with award rates matched by VIN.">
    <View style={styles.filters}>
      <View style={styles.field}><Text style={styles.fieldLabel}>Geographic area</Text><FilterSelect accessibilityLabel="Geographic area" value={areaId} onChange={setAreaId} options={areas.map(item=>({value:String(item.id),label:item.name}))}/></View>
      <View style={styles.field}><Text style={styles.fieldLabel}>Dispatch center</Text><FilterSelect accessibilityLabel="Dispatch center" value={centerId} onChange={setCenterId} options={centers.map(item=>({value:String(item.id),label:item.name}))}/></View>
      <View style={styles.field}><Text style={styles.fieldLabel}>Priority list</Text><FilterSelect accessibilityLabel="Priority list" value={listId} onChange={setListId} options={lists.map(item=>({value:String(item.file_id),label:item.resource_type||item.name}))}/></View>
    </View>
    <Pressable accessibilityRole="button" disabled={loading} onPress={()=>setRefresh(value=>value+1)} style={({pressed})=>[styles.refresh,pressed&&styles.pressed,loading&&styles.disabled]}><AppSymbol name={{ios:'arrow.clockwise',android:'refresh'}} size={17} color={theme.green}/><Text style={styles.refreshText}>Refresh dispatch data</Text>{loading?<ActivityIndicator size="small" color={theme.green}/>:null}</Pressable>
    {error?<View accessibilityRole="alert" style={[styles.state,styles.errorState]}><Text style={styles.stateTitle}>Dispatch data unavailable</Text><Text style={styles.errorText}>{error}</Text></View>:null}
    {!error&&!supabase?<View style={styles.state}><Text style={styles.stateTitle}>Supabase connection required</Text></View>:null}
    {!error&&supabase&&!loading&&!selectedList?<View style={styles.state}><Text style={styles.stateTitle}>No published lists found</Text><Text style={styles.stateCopy}>Try another dispatch center or check after scheduled import.</Text></View>:null}
    {selectedList?<View style={styles.results}>
      <View style={styles.resultsHeader}><View style={styles.headerCopy}><Text style={styles.resultsTitle}>{selectedList.resource_type||selectedList.name}</Text><Text style={styles.resultsMeta}>{selectedList.published_at?`Published ${new Date(selectedList.published_at).toLocaleString()}`:'Publish date unavailable'} · {entries.length} resources</Text></View>{selectedList.sync_status==='partial'?<Text style={styles.warning}>Rates updating</Text>:null}</View>
      {entries.map(entry=><View key={entry.rank} style={styles.entry}>
        <View style={styles.rank}><Text style={styles.rankLabel}>RANK</Text><Text style={styles.rankValue}>{entry.rank}</Text></View>
        <View style={styles.entryCopy}><Text style={styles.company}>{entry.company_name||'Not reported'}</Text><Text style={styles.detail}>{entry.equipment_location||'Location not reported'}</Text><Text style={styles.vin}>VIN {entry.vin||'Not reported'}</Text><View style={styles.entryFooter}><Text style={styles.cafs}>CAFS {entry.cafs||'Not reported'}</Text><Text style={[styles.rate,entry.rate_status!=='matched'&&styles.unmatched]}>{entry.rate_status==='matched'&&entry.daily_rate!==null?Number(entry.daily_rate).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2}):entry.rate_status==='ambiguous'?'Rate needs review':'Rate not matched'}</Text></View></View>
      </View>)}
      <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(sourceUrl)} style={({pressed})=>[styles.source,pressed&&styles.pressed]}><Text style={styles.sourceText}>Source: USDA Forest Service VIPR public records. Verify official source. FireOps is not affiliated with or endorsed by USDA or Forest Service.</Text><AppSymbol name={{ios:'arrow.up.right.square',android:'open_in_new'}} size={16} color={theme.green}/></Pressable>
    </View>:null}
  </SectionScreen>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  filters:{gap:14},field:{gap:6},fieldLabel:{color:theme.secondary,fontSize:11,fontWeight:'800',textTransform:'uppercase',letterSpacing:.6},
  refresh:{minHeight:48,marginVertical:16,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper},refreshText:{color:theme.green,fontSize:14,fontWeight:'800'},pressed:{opacity:.68},disabled:{opacity:.55},
  state:{padding:24,alignItems:'center',gap:6,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},errorState:{borderColor:theme.danger},stateTitle:{color:theme.ink,fontSize:16,fontWeight:'800'},stateCopy:{color:theme.secondary,fontSize:13,lineHeight:19,textAlign:'center'},errorText:{color:theme.danger,fontSize:13,lineHeight:19,textAlign:'center'},
  results:{overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},resultsHeader:{padding:16,flexDirection:'row',alignItems:'flex-start',gap:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},headerCopy:{flex:1},resultsTitle:{color:theme.ink,fontSize:17,lineHeight:22,fontWeight:'800'},resultsMeta:{marginTop:5,color:theme.secondary,fontSize:11,lineHeight:16},warning:{overflow:'hidden',paddingHorizontal:8,paddingVertical:5,borderRadius:999,backgroundColor:theme.warningSurface,color:theme.warning,fontSize:10,fontWeight:'800'},
  entry:{padding:14,flexDirection:'row',alignItems:'flex-start',gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},rank:{width:45,alignItems:'center',paddingVertical:7,borderRadius:10,backgroundColor:theme.surfaceAlt},rankLabel:{color:theme.secondary,fontSize:8,fontWeight:'800'},rankValue:{marginTop:2,color:theme.ink,fontSize:18,fontWeight:'900'},entryCopy:{flex:1,minWidth:0},company:{color:theme.ink,fontSize:15,lineHeight:20,fontWeight:'800'},detail:{marginTop:4,color:theme.secondary,fontSize:12,lineHeight:17},vin:{marginTop:5,color:theme.secondary,fontSize:11,lineHeight:16,fontFamily:'monospace'},entryFooter:{marginTop:9,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},cafs:{color:theme.secondary,fontSize:11,fontWeight:'700'},rate:{color:theme.green,fontSize:14,fontWeight:'900'},unmatched:{color:theme.secondary,fontSize:11},
  source:{padding:14,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:theme.surfaceAlt},sourceText:{flex:1,color:theme.secondary,fontSize:10,lineHeight:15},
})}
