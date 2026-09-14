import DateTimePicker,{type DateTimePickerEvent} from '@react-native-community/datetimepicker';
import type {AnnualQualificationRecord} from '@fireops/domain';
import {Redirect,Stack,useRouter} from 'expo-router';
import {useEffect,useMemo,useState} from 'react';
import {Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppSymbol} from '@/components/app-symbol';
import {updateMyAnnualQualificationRecord,useFleetVehicles} from '@/lib/fleet-store';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

type DateKey=keyof AnnualQualificationRecord;
const fields:{key:DateKey;label:string;placeholder:string}[]=[
  {key:'rt130CompletionDate',label:'RT-130 completion date',placeholder:'Select completion date'},
  {key:'rt130CurrencyDate',label:'RT-130 currency date',placeholder:'Select currency date'},
  {key:'wctCompletionDate',label:'WCT completion date',placeholder:'Select completion date'},
  {key:'wctCurrencyDate',label:'WCT currency date',placeholder:'Select currency date'},
];
const emptyRecord:AnnualQualificationRecord={rt130CompletionDate:'',rt130CurrencyDate:'',wctCompletionDate:'',wctCurrencyDate:''};

export default function AnnualRecordsScreen(){
  const router=useRouter();const theme=useFireOpsTheme();const styles=useMemo(()=>createStyles(theme),[theme]);const {session,access}=useSession();const account=access.value?.kind==='member'?access.value:null;const {crew}=useFleetVehicles(account?.company.id??null);const member=crew.find(item=>item.id===account?.user.id);
  const [record,setRecord]=useState<AnnualQualificationRecord>(emptyRecord);const [showDate,setShowDate]=useState<DateKey|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(member?.annualRecord)setRecord(member.annualRecord)},[member?.annualRecord]);
  if(!session||access.status==='error')return <Redirect href="/"/>;
  if(!account)return null;
  const valid=fields.every(({key})=>Boolean(record[key]));
  const pick=(key:DateKey)=>(event:DateTimePickerEvent,date?:Date)=>{if(Platform.OS==='android')setShowDate(null);if(event.type==='set'&&date)setRecord(current=>({...current,[key]:toDate(date)}))};
  const save=async()=>{if(!valid)return;setBusy(true);setError('');try{await updateMyAnnualQualificationRecord(account.company.id,record);router.replace('/qualifications' as never)}catch(saveError){setError(saveError instanceof Error?saveError.message:'Annual record could not be saved.')}finally{setBusy(false)}};
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Update annual records'}}/><ScrollView contentContainerStyle={styles.content}>
    <View><Text accessibilityRole="header" style={styles.title}>Update annual records</Text><Text style={styles.subtitle}>Keep current annual fireline and work capacity dates on file.</Text></View>
    <RecordSection title="Annual Fire Line Refresher" fieldKeys={['rt130CompletionDate','rt130CurrencyDate']} record={record} showDate={showDate} setShowDate={setShowDate} pick={pick} styles={styles} theme={theme}/>
    <RecordSection title="Work Capacity Test" fieldKeys={['wctCompletionDate','wctCurrencyDate']} record={record} showDate={showDate} setShowDate={setShowDate} pick={pick} styles={styles} theme={theme}/>
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}<Pressable disabled={busy||!valid} onPress={()=>void save()} style={[styles.save,(busy||!valid)&&styles.disabled]}><Text style={styles.saveText}>{busy?'Saving…':member?.annualRecord?'Save changes':'Save annual record'}</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
function RecordSection({title,fieldKeys,record,showDate,setShowDate,pick,styles,theme}:{title:string;fieldKeys:DateKey[];record:AnnualQualificationRecord;showDate:DateKey|null;setShowDate:(key:DateKey|null)=>void;pick:(key:DateKey)=>(event:DateTimePickerEvent,date?:Date)=>void;styles:ReturnType<typeof createStyles>;theme:FireOpsTheme}){return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{fieldKeys.map(key=>{const field=fields.find(item=>item.key===key)!;const value=record[key];const isCompletion=key.endsWith('CompletionDate');const completionKey:keyof AnnualQualificationRecord=key.startsWith('rt130')?'rt130CompletionDate':'wctCompletionDate';return <View style={styles.field} key={key}><Text style={styles.label}>{field.label}<Text style={styles.required}> *</Text></Text><Pressable onPress={()=>setShowDate(showDate===key?null:key)} style={styles.dateButton}><AppSymbol name="calendar" color={theme.secondary} size={18}/><Text style={value?styles.dateValue:styles.datePlaceholder}>{value?formatDate(value):field.placeholder}</Text></Pressable>{showDate===key?<DateTimePicker value={value?fromDate(value):new Date()} mode="date" display={Platform.OS==='ios'?'inline':'default'} maximumDate={isCompletion?new Date():undefined} minimumDate={!isCompletion&&record[completionKey]?fromDate(record[completionKey]):undefined} onChange={pick(key)}/>:null}</View>})}</View>}
function toDate(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function fromDate(date:string){return new Date(`${date}T12:00:00`)}
function formatDate(date:string){return fromDate(date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:54,gap:19},title:{color:theme.ink,fontSize:28,fontWeight:'800'},subtitle:{color:theme.secondary,fontSize:14,lineHeight:20,marginTop:5},section:{gap:17,padding:17,borderWidth:1,borderColor:theme.divider,borderRadius:13,backgroundColor:theme.paper},sectionTitle:{color:theme.ink,fontSize:18,fontWeight:'800'},field:{gap:8},label:{color:theme.ink,fontSize:13,fontWeight:'800'},required:{color:theme.ember},dateButton:{minHeight:49,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.canvas,paddingHorizontal:13,flexDirection:'row',alignItems:'center',gap:9},dateValue:{color:theme.ink,fontSize:16},datePlaceholder:{color:theme.secondary,fontSize:16},error:{color:theme.danger,backgroundColor:theme.dangerSurface,padding:13,borderRadius:10,lineHeight:19},save:{minHeight:51,borderRadius:11,backgroundColor:theme.ember,alignItems:'center',justifyContent:'center'},saveText:{color:'#fff',fontSize:16,fontWeight:'800'},disabled:{opacity:.48}})}
