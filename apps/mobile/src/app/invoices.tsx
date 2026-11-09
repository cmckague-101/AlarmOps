import {useEffect,useMemo,useState} from 'react';
import {Alert,Pressable,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Redirect,Stack,useRouter} from 'expo-router';
import {canProcessFinance,formatCalendarDate,invoiceDueDate,invoicePaymentState} from '@fireops/domain';
import {SafeAreaView} from 'react-native-safe-area-context';
import { DownloadedListNotice } from '@/components/downloaded-list-notice';
import {AppSymbol} from '@/components/app-symbol';
import {refreshInvoices,useInvoices} from '@/lib/invoice-store';
import {loadReceiptAutofillEnabled} from '@/lib/receipts-store';
import {useNetworkStatus} from '@/providers/network-provider';
import {useDeviceInvoices} from '@/lib/use-device-forms';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';
import {HeroTitle} from '@/components/hero-title';
const money=(value:number)=>value.toLocaleString('en-US',{style:'currency',currency:'USD'});
type PaymentFilter='all'|'unpaid'|'paid';
const paymentFilters:{value:PaymentFilter;label:string}[]=[{value:'all',label:'All'},{value:'unpaid',label:'Unpaid'},{value:'paid',label:'Paid'}];
const paymentLabel={unpaid:'Unpaid',overdue:'Overdue',paid:'Paid',draft:'Draft'} as const;
export default function Screen(){
  const router=useRouter(),theme=useFireOpsTheme(),styles=useMemo(()=>createStyles(theme),[theme]);
  const {session,access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const manager=Boolean(member&&canProcessFinance(member.user.role));
  const invoices=useInvoices(member?.company.id??null);
  const {customers,loading,refreshing,error}=invoices;
  const {forms,device}=useDeviceInvoices(invoices.forms,member,invoices.downloaded?.receiptWatermark);
  const [paymentFilter,setPaymentFilter]=useState<PaymentFilter>('all');
  const {isOffline:offline}=useNetworkStatus();
  const companyId=member?.company.id??null;
  // Invoice auto-fill shares the receipt auto-fill switch; it needs a connection.
  const [autofillEnabled,setAutofillEnabled]=useState(false);
  useEffect(()=>{let active=true;setAutofillEnabled(false);if(companyId&&!offline)void loadReceiptAutofillEnabled(companyId).then(enabled=>{if(active)setAutofillEnabled(enabled)});return()=>{active=false}},[companyId,offline]);
  if(!session||access.status==='error')return <Redirect href="/"/>;
  const draft=forms.find(form=>form.status==='draft'&&form.createdBy===member?.user.id);
  const submittedAll=forms.filter(form=>form.status!=='draft');
  const submitted=submittedAll.filter(form=>paymentFilter==='all'||(paymentFilter==='paid')===(form.status==='paid'));
  const open=(id?:string)=>router.push({pathname:'/invoices/form',params:id?{invoiceId:id}:{}} as never);
  // The form opens the draft in progress (or a new one) and starts the camera.
  const scan=()=>{const go=()=>router.push({pathname:'/invoices/form',params:{scan:'1'}} as never);if(draft&&(draft.invoiceNumber.trim()||draft.invoiceAmount>0||draft.customerId||draft.attachment)){Alert.alert('Scan into your invoice in progress?','Details read from the photo replace what is there.',[{text:'Cancel',style:'cancel'},{text:'Scan',onPress:go}]);return}go()};
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Invoices'}}/><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshInvoices} tintColor={theme.commandForeground}/>}>
    <View style={styles.heading}><HeroTitle style={styles.title}>Invoices</HeroTitle><View style={styles.actions}>{manager?<Pressable accessibilityRole="button" onPress={()=>router.push('/invoices/generator' as never)} style={styles.secondary}><Text style={styles.secondaryText}>Invoice Generator</Text></Pressable>:null}{autofillEnabled&&!offline?<Pressable accessibilityRole="button" accessibilityLabel="Scan invoice" onPress={scan} style={styles.secondary}><AppSymbol name={{ios:'camera',android:'photo_camera'} as never} color={theme.commandForeground} size={17}/><Text style={styles.secondaryText}>Scan invoice</Text></Pressable>:null}<Pressable onPress={()=>open(draft?.id)} style={styles.add}><AppSymbol name={{ios:'plus',android:'add'} as never} color="#fff" size={18}/><Text style={styles.addText}>New Invoice</Text></Pressable></View></View>
    {draft?<Pressable onPress={()=>open(draft.id)} style={styles.draft}><View style={styles.grow}><Text style={styles.rowTitle}>Invoice in progress</Text><Text style={styles.meta}>{device.has(draft.id)?'Saved on this device — syncs when connected':`Saved ${new Date(draft.updatedAt).toLocaleString()}`}</Text></View><Text style={styles.continue}>Continue</Text></Pressable>:null}
    <DownloadedListNotice info={invoices.downloaded}/>
    {submittedAll.length?<View accessibilityRole="radiogroup" style={styles.filterRow}>{paymentFilters.map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityState={{checked:paymentFilter===option.value}} onPress={()=>setPaymentFilter(option.value)} style={[styles.filterChip,paymentFilter===option.value&&styles.filterChipSelected]}><Text style={[styles.filterText,paymentFilter===option.value&&styles.filterTextSelected]}>{option.label}</Text></Pressable>)}</View>:null}
    {error?<Text style={styles.error}>{error}</Text>:null}
    {loading?<Text style={styles.state}>Loading invoices…</Text>:null}
    {!loading&&!error&&!submittedAll.length?<View style={styles.empty}><View style={styles.emptyIcon}><AppSymbol name={{ios:'doc.text',android:'description'} as never} color={theme.secondary} size={28}/></View><Text style={styles.emptyTitle}>No submitted invoices</Text><Text style={styles.emptyText}>{draft?'Continue your invoice in progress to submit it.':'Tap New Invoice to submit your first invoice.'}</Text></View>:null}
    <View style={styles.list}>{submitted.map(form=>{const editable=form.status!=='paid'&&(form.createdBy===member?.user.id||manager);return <Pressable key={form.id} onPress={()=>open(form.id)} style={styles.row}><View style={styles.icon}><AppSymbol name={{ios:'doc.text.fill',android:'description'} as never} color={theme.commandForeground} size={21}/></View><View style={styles.grow}><Text style={styles.rowTitle}>{form.invoiceNumber}</Text><Text style={styles.meta}>{customers.find(item=>item.id===form.customerId)?.name??'Customer unavailable'} · {formatCalendarDate(form.invoiceDate)}</Text>{device.has(form.id)?<Text style={styles.meta}>Submission saved on this device</Text>:null}</View><View style={styles.rowEnd}><Text style={styles.amount}>{money(form.invoiceAmount)}</Text><Text style={[styles.payment,{unpaid:styles.unpaidBadge,overdue:styles.overdueBadge,paid:styles.paidBadge,draft:styles.draftBadge}[invoicePaymentState(form)]]}>{paymentLabel[invoicePaymentState(form)]}</Text>{form.status!=='paid'&&invoiceDueDate(form)?<Text style={styles.meta}>Due {formatCalendarDate(invoiceDueDate(form))}</Text>:null}<Text style={styles.meta}>{editable?'Edit':'View'}</Text></View></Pressable>})}{submittedAll.length&&!submitted.length?<Text style={styles.state}>No {paymentFilter} invoices.</Text>:null}</View>
  </ScrollView></SafeAreaView>;
}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:18},heading:{gap:14},title:{color:theme.ink,fontSize:30,fontWeight:'800'},actions:{flexDirection:'row',flexWrap:'wrap',gap:9},add:{flexGrow:1,minHeight:46,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:14,borderRadius:11,backgroundColor:theme.ember},addText:{color:'#fff',fontWeight:'800'},secondary:{flexGrow:1,minHeight:46,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:14,borderWidth:1,borderColor:theme.divider,borderRadius:11,backgroundColor:theme.paper},secondaryText:{color:theme.commandForeground,fontWeight:'800'},draft:{minHeight:75,flexDirection:'row',alignItems:'center',gap:12,padding:15,borderWidth:1,borderColor:theme.commandForeground,borderRadius:13,backgroundColor:theme.paper},grow:{flex:1},continue:{color:theme.commandForeground,fontWeight:'800'},error:{color:theme.danger,backgroundColor:theme.dangerSurface,padding:13,borderRadius:10},state:{color:theme.secondary,textAlign:'center',padding:28},empty:{alignItems:'center',paddingHorizontal:24,paddingVertical:42,gap:8},emptyIcon:{width:56,height:56,alignItems:'center',justifyContent:'center',borderRadius:28,backgroundColor:theme.surfaceAlt},emptyTitle:{color:theme.ink,fontSize:18,fontWeight:'700'},emptyText:{color:theme.secondary,fontSize:14,lineHeight:20,textAlign:'center'},list:{gap:11},row:{minHeight:76,flexDirection:'row',alignItems:'center',gap:11,padding:13,borderWidth:1,borderColor:theme.divider,borderRadius:13,backgroundColor:theme.paper},icon:{width:42,height:42,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:theme.surfaceAlt},rowTitle:{color:theme.ink,fontSize:15,fontWeight:'800'},meta:{color:theme.secondary,fontSize:11,marginTop:4},amount:{color:theme.ink,fontSize:14,fontWeight:'800'},rowEnd:{alignItems:'flex-end',gap:4},payment:{overflow:'hidden',borderRadius:999,paddingHorizontal:8,paddingVertical:3,fontSize:11,fontWeight:'800'},unpaidBadge:{color:theme.blue,backgroundColor:theme.blueSurface},overdueBadge:{color:theme.danger,backgroundColor:theme.dangerSurface},paidBadge:{color:theme.green,backgroundColor:theme.greenSurface},draftBadge:{color:theme.secondary,backgroundColor:theme.surfaceAlt},filterRow:{flexDirection:'row',gap:8},filterChip:{minHeight:34,justifyContent:'center',paddingHorizontal:13,borderRadius:999,borderWidth:1,borderColor:theme.divider,backgroundColor:theme.paper},filterChipSelected:{backgroundColor:theme.ember,borderColor:theme.ember},filterText:{color:theme.secondary,fontSize:13,fontWeight:'700'},filterTextSelected:{color:'#FFFFFF'}})}
