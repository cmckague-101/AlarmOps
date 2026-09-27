import {Redirect} from 'expo-router';
import {useEffect,useMemo,useState} from 'react';
import {Pressable,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppSymbol} from '@/components/app-symbol';
import {supabase} from '@/lib/supabase';
import {AdminCompany,useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

type CompanyRow={id:string;name:string;company_code:string;industry:string;phone:string;location:string;logo_path:string|null;crew_invite_limit:number};
export default function CompaniesScreen(){
  const theme=useFireOpsTheme();const styles=useMemo(()=>createStyles(theme),[theme]);const {session,access,selectCompany,signOut}=useSession();
  const [companies,setCompanies]=useState<AdminCompany[]>([]);const [loading,setLoading]=useState(true);const [busyId,setBusyId]=useState('');const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;void (async()=>{if(!supabase)return;const {data,error:loadError}=await supabase.from('companies').select('id,name,company_code,industry,phone,location,logo_path,crew_invite_limit').order('name');if(!active)return;if(loadError)setError('Companies could not be loaded. Check connection and try again.');else setCompanies(((data??[]) as CompanyRow[]).map(row=>({id:row.id,name:row.name,code:row.company_code,industry:row.industry,phone:row.phone,location:row.location,logoPath:row.logo_path,crewInviteLimit:row.crew_invite_limit})));setLoading(false)})();return()=>{active=false}},[attempt]);
  if(!session)return <Redirect href="/sign-in"/>;
  if(access.value?.kind==='member')return <Redirect href="/(tabs)"/>;
  if(access.status==='error')return <Redirect href="/"/>;
  const open=async(company:AdminCompany)=>{if(busyId)return;setBusyId(company.id);setError('');try{await selectCompany(company)}catch(openError){setError(openError instanceof Error?openError.message:'Company could not be opened.');setBusyId('')} };
  return <SafeAreaView style={styles.safe} edges={['bottom']}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>{setLoading(true);setError('');setAttempt(value=>value+1)}} tintColor={theme.commandForeground}/>}>
    <View style={styles.mark}><AppSymbol name={{ios:'building.2.fill',android:'business'} as never} color={theme.commandText} size={28}/></View><Text accessibilityRole="header" style={styles.title}>Administrator access</Text><Text style={styles.subtitle}>Choose company to troubleshoot with owner permissions. Access is recorded.</Text>
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    <View style={styles.list}>{companies.map(company=><Pressable key={company.id} accessibilityRole="button" disabled={Boolean(busyId)} onPress={()=>void open(company)} style={({pressed})=>[styles.row,pressed&&styles.pressed]}><View style={styles.rowCopy}><Text style={styles.name}>{company.name}</Text><Text style={styles.code}>{company.code} · {company.industry||'Industry not specified'}</Text></View><Text style={styles.open}>{busyId===company.id?'Opening…':'Open'}</Text><AppSymbol name="chevron.right" color={theme.secondary} size={16}/></Pressable>)}{!loading&&!companies.length&&!error?<Text style={styles.empty}>No companies found.</Text>:null}</View>
    <Pressable accessibilityRole="button" onPress={()=>void signOut()} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{flexGrow:1,paddingHorizontal:22,paddingTop:70,paddingBottom:38},mark:{width:58,height:58,borderRadius:15,backgroundColor:theme.command,alignItems:'center',justifyContent:'center',marginBottom:20},title:{color:theme.ink,fontSize:29,fontWeight:'800'},subtitle:{color:theme.secondary,fontSize:15,lineHeight:22,marginTop:8,marginBottom:24},error:{color:theme.danger,backgroundColor:theme.dangerSurface,padding:13,borderRadius:10,fontSize:13,lineHeight:19,marginBottom:14},list:{overflow:'hidden',backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:13},row:{minHeight:72,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:15,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},rowCopy:{flex:1,gap:4},name:{color:theme.ink,fontSize:16,fontWeight:'700'},code:{color:theme.secondary,fontSize:12},open:{color:theme.commandForeground,fontSize:12,fontWeight:'700'},empty:{color:theme.secondary,textAlign:'center',padding:30},signOut:{minHeight:48,alignItems:'center',justifyContent:'center',marginTop:20},signOutText:{color:theme.danger,fontSize:15,fontWeight:'700'},pressed:{opacity:.65}})}
