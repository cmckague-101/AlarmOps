import * as Print from 'expo-print';
import {Redirect,Stack,useRouter} from 'expo-router';
import * as Sharing from 'expo-sharing';
import {useMemo,useState} from 'react';
import {Alert,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppSymbol} from '@/components/app-symbol';
import {useFleetVehicles} from '@/lib/fleet-store';
import {createMasterRecordHtml,getMasterRecordSections} from '@/lib/master-record';
import {useSession} from '@/providers/session-provider';
import {type FireOpsTheme,useFireOpsTheme} from '@/theme';

export default function MasterRecordScreen(){
  const router=useRouter();
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {session,access}=useSession();
  const account=access.value?.kind==='member'?access.value:null;
  const {crew,loading,error}=useFleetVehicles(account?.company.id??null);
  const member=crew.find(item=>item.id===account?.user.id);
  const sections=member?getMasterRecordSections(member):[];
  const [preparing,setPreparing]=useState(false);

  if(!session||access.status==='error')return <Redirect href="/"/>;

  const preparePacket=async()=>{
    if(!member||preparing)return;
    setPreparing(true);
    try{
      const result=await Print.printToFileAsync({html:createMasterRecordHtml(member)});
      if(await Sharing.isAvailableAsync()){
        await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:'Save or share PDF packet'});
      }else{
        await Print.printAsync({uri:result.uri});
      }
    }catch(caught){
      Alert.alert('PDF packet not prepared',caught instanceof Error?caught.message:'Please try again.');
    }finally{setPreparing(false)}
  };

  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Master record'}}/><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={()=>router.back()} style={({pressed})=>[styles.back,pressed&&styles.pressed]}><AppSymbol name="chevron.left" color={theme.ink} size={19}/><Text style={styles.backText}>Back to qualifications</Text></Pressable>
    {loading?<Text style={styles.state}>Loading master record…</Text>:error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:!member?<View style={styles.empty}><AppSymbol name="doc.text.fill" color={theme.ember} size={31}/><Text style={styles.emptyTitle}>No responder record found</Text><Text style={styles.emptyText}>Your crew profile is not available.</Text></View>:<>
      <View style={styles.heading}><Text style={styles.eyebrow}>RESPONDER MASTER RECORD</Text><Text accessibilityRole="header" style={styles.title}>{member.name}</Text></View>
      <Pressable accessibilityRole="button" disabled={preparing} onPress={()=>void preparePacket()} style={({pressed})=>[styles.prepare,(pressed||preparing)&&styles.preparePressed]}><AppSymbol name="square.and.arrow.down" color={theme.commandText} size={20}/><Text style={styles.prepareText}>{preparing?'Preparing PDF…':'Prepare PDF Packet'}</Text></Pressable>
      <View style={styles.summary}><Summary label="Credentials on record" value={member.credentials?.length??0} styles={styles}/><View style={styles.summaryRule}/><Summary label="Incident experience" value={member.experiences?.length??0} styles={styles}/></View>
      <View style={styles.sections}>{sections.map(section=><View style={styles.section} key={section.title}><View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{section.title}</Text><Text style={styles.count}>{section.rows.length}</Text></View>{section.rows.length?section.rows.map((row,rowIndex)=><View style={styles.record} key={`${section.title}-${rowIndex}`}>{row.map((value,columnIndex)=><View style={styles.field} key={section.columns[columnIndex]}><Text style={styles.label}>{section.columns[columnIndex]}</Text><Text style={styles.value}>{value}</Text></View>)}</View>):<Text style={styles.noRecords}>No records on file</Text>}</View>)}</View>
    </>}
  </ScrollView></SafeAreaView>;
}

function Summary({label,value,styles}:{label:string;value:number;styles:ReturnType<typeof createStyles>}){return <View style={styles.summaryItem}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:54,gap:18},back:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:5,minHeight:34},backText:{color:theme.ink,fontSize:14,fontWeight:'700'},pressed:{opacity:.65},heading:{gap:5},eyebrow:{color:theme.ember,fontSize:12,fontWeight:'800',letterSpacing:1.1},title:{color:theme.ink,fontSize:29,fontWeight:'800'},subtitle:{color:theme.secondary,fontSize:14,lineHeight:20},prepare:{minHeight:48,borderRadius:10,backgroundColor:theme.command,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},preparePressed:{opacity:.7},prepareText:{color:theme.commandText,fontSize:15,fontWeight:'800'},summary:{flexDirection:'row',backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:12},summaryItem:{flex:1,padding:15,gap:4},summaryRule:{width:1,backgroundColor:theme.divider},summaryLabel:{color:theme.secondary,fontSize:10,fontWeight:'800',letterSpacing:.5,textTransform:'uppercase'},summaryValue:{color:theme.ink,fontSize:22,fontWeight:'800'},sections:{gap:14},section:{borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper,overflow:'hidden'},sectionHeading:{minHeight:47,paddingHorizontal:15,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,backgroundColor:theme.surfaceAlt,borderBottomWidth:1,borderBottomColor:theme.divider},sectionTitle:{flex:1,color:theme.ink,fontSize:13,fontWeight:'800',letterSpacing:.45,textTransform:'uppercase'},count:{minWidth:25,textAlign:'center',color:theme.secondary,fontSize:12,fontWeight:'800'},record:{padding:15,gap:11,borderBottomWidth:1,borderBottomColor:theme.divider},field:{gap:2},label:{color:theme.secondary,fontSize:10,fontWeight:'800',letterSpacing:.5,textTransform:'uppercase'},value:{color:theme.ink,fontSize:14,lineHeight:19},noRecords:{padding:17,color:theme.secondary,fontSize:14,fontStyle:'italic'},state:{color:theme.secondary,paddingVertical:30,textAlign:'center'},error:{color:theme.danger,padding:15,backgroundColor:theme.dangerSurface,borderRadius:10},empty:{alignItems:'center',paddingVertical:54,gap:7},emptyTitle:{color:theme.ink,fontSize:18,fontWeight:'800'},emptyText:{color:theme.secondary,fontSize:14},
})}
