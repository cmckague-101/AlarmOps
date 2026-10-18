import {useCallback,useEffect,useMemo,useState} from 'react';
import {Redirect,Stack,useLocalSearchParams} from 'expo-router';
import {ActivityIndicator,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {AppSymbol} from '@/components/app-symbol';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

type Feedback={
  id:string;
  category:'idea'|'issue'|'other';
  message:string;
  source:'web'|'ios'|'android';
  source_company_name:string;
  source_company_code:string;
  submitter_name:string;
  submitter_email:string;
  created_at:string;
};

const categoryLabel:Record<Feedback['category'],string>={idea:'Idea or suggestion',issue:'Problem or issue',other:'Other feedback'};
const sourceLabel:Record<Feedback['source'],string>={web:'Web',ios:'iOS',android:'Android'};

export default function FeedbackDetailScreen(){
  const {id}=useLocalSearchParams<{id:string}>();
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {session,access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');

  const load=useCallback(async(refresh=false)=>{
    if(!supabase||!id)return;
    refresh?setRefreshing(true):setLoading(true);setError('');
    const {data,error:loadError}=await supabase.from('app_feedback').select('id,category,message,source,source_company_name,source_company_code,submitter_name,submitter_email,created_at').eq('id',id).maybeSingle<Feedback>();
    if(loadError)setError(`Feedback could not load. ${loadError.message}`);else if(!data)setError('Feedback was not found or you do not have access.');else setFeedback(data);
    setLoading(false);setRefreshing(false);
  },[id]);

  useEffect(()=>{void load()},[load]);
  if(!session||access.status==='error')return <Redirect href="/"/>;
  if(member?.user.role!=='owner'||member.company.code!=='FCLLC-2026')return <Redirect href="/"/>;

  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'App feedback'}}/><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={theme.commandForeground}/>}>
    {loading?<ActivityIndicator color={theme.ember}/>:error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:feedback?<>
      <View style={styles.heading}><View style={styles.icon}><AppSymbol name={{ios:'bubble.left.and.bubble.right.fill',android:'feedback'} as never} color={theme.commandForeground} size={22}/></View><View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>App feedback</Text><Text style={styles.date}>{new Date(feedback.created_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</Text></View></View>
      <View style={styles.card}><Text style={styles.label}>Feedback type</Text><Text style={styles.value}>{categoryLabel[feedback.category]}</Text><View style={styles.divider}/><Text style={styles.label}>Message</Text><Text selectable style={styles.message}>{feedback.message}</Text></View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Submitted by</Text><Detail label="Name" value={feedback.submitter_name} styles={styles}/><Detail label="Email" value={feedback.submitter_email} styles={styles}/><Detail label="Company" value={feedback.source_company_name} styles={styles}/><Detail label="Company code" value={feedback.source_company_code} styles={styles}/><Detail label="App" value={sourceLabel[feedback.source]} styles={styles}/></View>
    </>:null}
  </ScrollView></SafeAreaView>;
}

function Detail({label,value,styles}:{label:string;value:string;styles:ReturnType<typeof createStyles>}){return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:17},heading:{flexDirection:'row',alignItems:'center',gap:12},icon:{width:46,height:46,borderRadius:12,backgroundColor:theme.surfaceAlt,alignItems:'center',justifyContent:'center'},headingCopy:{flex:1,gap:3},title:{color:theme.ink,fontSize:26,fontWeight:'800'},date:{color:theme.secondary,fontSize:12},card:{backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:17,gap:8},label:{color:theme.secondary,fontSize:11,fontWeight:'700',textTransform:'uppercase',letterSpacing:.5},value:{color:theme.ink,fontSize:16,fontWeight:'800'},message:{color:theme.ink,fontSize:15,lineHeight:23},divider:{height:StyleSheet.hairlineWidth,backgroundColor:theme.divider,marginVertical:7},sectionTitle:{color:theme.ink,fontSize:18,fontWeight:'800',marginBottom:3},detail:{minHeight:43,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.divider},detailLabel:{flex:1,color:theme.secondary,fontSize:13},detailValue:{maxWidth:'68%',color:theme.ink,fontSize:13,fontWeight:'700',textAlign:'right'},error:{color:theme.danger,backgroundColor:theme.dangerSurface,borderRadius:10,padding:13,fontSize:13,lineHeight:19}})}
