import {canManagePersonalTasks,canViewCrewRoster,canWorkShop,failedInspectionCount,isDocumentUnread,isTrainingUnread} from '@fireops/domain';
import {useRouter} from 'expo-router';
import {Alert,Platform,Pressable,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {AppSymbol} from '@/components/app-symbol';
import {AccentRail,pressedTileStyle,useReduceMotion,withAlpha} from '@/components/accent-tile';
import {useFleetVehicles} from '@/lib/fleet-store';
import {useTaskCount} from '@/lib/use-task-count';
import {quickActionItems} from '@/components/quick-actions';
import {SectionScreen} from '@/components/section-screen';
import {ViprIntelligenceIcon} from '@/components/vipr-intelligence-icon';
import {useCompanyDocuments} from '@/lib/documents-store';
import {useTrainings} from '@/lib/training-store';
import {usePendingQualificationCardCount} from '@/lib/qualification-card-store';
import {useDashboardPreferences} from '@/lib/use-dashboard-preferences';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

const sections=[
  // News Feed sits right after Comms (the Messages tab), matching the web sidebar.
  {label:'News Feed',path:'/news-feed',ios:'newspaper.fill',android:'newspaper',color:'#B45309'},
  {label:'Receipts',path:'/receipts',ios:'receipt',android:'receipt_long',color:'#C94321'},
  {label:'Documents',path:'/documents',ios:'doc.text.fill',android:'description',color:'#285F9E'},
  {label:'Qualifications',path:'/qualifications',ios:'checkmark.seal.fill',android:'verified',color:'#26765A'},
  {label:'Training',path:'/training',ios:'graduationcap.fill',android:'school',color:'#6552A3'},
  {label:'Roster',path:'/crew',ios:'person.3.fill',android:'groups',color:'#2E6E8C',rosterOnly:true},
  {label:'Inventory',path:'/inventory',ios:'shippingbox.fill',android:'inventory_2',color:'#7B5014'},
  {label:'Shop',path:'/shop',ios:'wrench.and.screwdriver.fill',android:'build',color:'#8A3418',shopOnly:true},
  // VIPR DPLs moved into VIPR Intelligence (with Send to VIPR for owners and admins).
  {label:'VIPR Intelligence',path:'/vipr-intelligence',ios:'shield.fill',android:'shield',color:'#1F5C48',viprIcon:true},
  {label:'Travel',path:'/hotels',ios:'bed.double.fill',android:'hotel',color:'#2F6A8F'},
  {label:'Failed Inspections',path:'/inspections',ios:'checklist.checked',android:'fact_check',color:'#3F6478',ownerOnly:true},
  {label:'Workforce',ios:'briefcase.fill',android:'business_center',color:'#34745C',comingSoon:true},
  {label:'Marketplace',ios:'storefront.fill',android:'storefront',color:'#A95616',comingSoon:true},
  {label:'Audit log',path:'/audit-log',ios:'clock.fill',android:'history',color:'#3F6478',ownerOnly:true},
  {label:'Saved changes & sync',path:'/sync-status',ios:'arrow.triangle.2.circlepath',android:'sync',color:'#3F6478',nativeOnly:true},
  {label:'Settings',path:'/settings',ios:'gearshape.fill',android:'settings',color:'#5F6963'},
] as const;

export default function More(){
  const router=useRouter();
  const theme=useFireOpsTheme();
  const {width,fontScale}=useWindowDimensions();
  const {access,signOut,demoMode}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const confirmSignOut=()=>{if(Platform.OS==='web'){void signOut();return}Alert.alert('Sign out?',demoMode?'You will leave the demo.':'You will need to sign in again to use FireOps.',[{text:'Cancel',style:'cancel'},{text:'Sign out',style:'destructive',onPress:()=>void signOut()}])};
  const {documents}=useCompanyDocuments(member?.company.id??null,member?.user.id??null);
  const {trainings}=useTrainings(member?.company.id??null,member?.user.id??null);
  const pendingQualificationCards=usePendingQualificationCardCount(member&&(member.user.role==='owner'||member.user.role==='admin')?member.company.id:null);
  const unreadDocuments=member?documents.filter(document=>isDocumentUnread(document,member.user)).length:0;
  const unreadTrainings=member?trainings.filter(training=>isTrainingUnread(training,member.user)).length:0;
  const preferences=useDashboardPreferences(member?.user.id,demoMode);
  const reduceMotion=useReduceMotion();
  const manager=member?.user.role==='owner'||member?.user.role==='admin';
  // Failed inspections and overdue tasks (when the Task List tile is hidden from the Dashboard) get the red urgent rail.
  const {vehicles}=useFleetVehicles(manager?member!.company.id:null);
  const failedInspections=manager?failedInspectionCount(vehicles):0;
  const tasksHidden=!!member&&canManagePersonalTasks(member.user.role)&&!preferences.visible('tasks');
  const overdueTasks=useTaskCount(tasksHidden?member!.company.id:undefined,tasksHidden?member!.user.id:undefined)?.overdue??0;
  // Quick actions hidden from the dashboard stay reachable here; Inventory, Shop and Failed Inspections are already listed.
  const listedPaths=new Set<string>(sections.flatMap(section=>'path' in section?[section.path]:[]));
  const hiddenQuickActions=member?quickActionItems(member.user.role,theme).filter(action=>!preferences.visible(action.item)&&!listedPaths.has(action.path)):[];
  const unreadBySection:Partial<Record<string,number>>={Documents:unreadDocuments,Qualifications:pendingQualificationCards,Training:unreadTrainings};
  const allowed=sections.filter(section=>(!('shopOnly' in section)||(member!=null&&canWorkShop(member.user.role)))&&(!('rosterOnly' in section)||(member!=null&&canViewCrewRoster(member.user.role)))&&(!('ownerOnly' in section)||(member?.user.role==='owner'||member?.user.role==='admin'))&&(!('nativeOnly' in section)||(!demoMode&&(Platform.OS==='ios'||Platform.OS==='android'))));
  const comingSoonIndex=allowed.findIndex(section=>'comingSoon' in section);
  const visible:{label:string;path?:string;ios:string;android:string;color:string;comingSoon?:boolean;viprIcon?:boolean}[]=[...allowed.slice(0,comingSoonIndex),...hiddenQuickActions,...allowed.slice(comingSoonIndex)];
  const singleColumn=width<360||fontScale>1.3;

  return <SectionScreen title="Tools" showHeader={false}>
    <View style={styles.grid}>{visible.map(section=>{
      const unread=unreadBySection[section.label]??0;const indicatorLabel=section.label==='Qualifications'?'pending':'new';
      const urgent=section.path==='/inspections'?failedInspections>0:section.path==='/tasks'?overdueTasks>0:false;
      const rail=urgent?theme.danger:section.color;
      return <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${section.label}${section.comingSoon?', coming soon':''}${unread>0?`, ${unread} ${indicatorLabel}`:''}${urgent?(section.path==='/tasks'?`, ${overdueTasks} overdue`:`, ${failedInspections} this year`):''}`}
        key={section.label}
        onPress={()=>{if(section.comingSoon||!section.path)Alert.alert('Coming Soon');else router.push(section.path as never)}}
        style={({pressed})=>[styles.card,{backgroundColor:theme.paper,borderColor:withAlpha(rail,.35)},singleColumn&&styles.fullCard,section.comingSoon&&styles.comingSoon,pressedTileStyle(rail,{pressed,reduceMotion})]}
      >
        <AccentRail color={rail}/>
        <View style={[styles.icon,{backgroundColor:section.color}]}>
          {section.viprIcon?<ViprIntelligenceIcon size={25} color="#FFFFFF"/>:<AppSymbol name={{ios:section.ios,android:section.android} as never} size={23} color="#FFFFFF"/>}
        </View>
        <Text style={[styles.label,{color:theme.ink}]}>{section.label}</Text>
        {section.comingSoon&&<Text style={[styles.soon,{color:theme.secondary}]}>Coming soon</Text>}
        {unread>0&&<Text style={[styles.badge,{color:theme.ember,backgroundColor:theme.dangerSurface}]}>{unread} {indicatorLabel}</Text>}
      </Pressable>;
    })}</View>
    <Pressable accessibilityRole="button" onPress={confirmSignOut} style={[styles.signOut,{borderColor:theme.divider}]}><Text style={[styles.signOutLabel,{color:theme.danger}]}>Sign out</Text></Pressable>
  </SectionScreen>;
}

const styles=StyleSheet.create({
  grid:{flexDirection:'row',flexWrap:'wrap',gap:12,marginTop:16},
  card:{width:'48%',flexGrow:1,overflow:'hidden',alignItems:'center',justifyContent:'center',gap:8,padding:14,minHeight:118,borderRadius:16,borderWidth:1},
  fullCard:{width:'100%'},
  icon:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:12},
  label:{fontSize:15,fontWeight:'800',textAlign:'center'},soon:{fontSize:13,fontWeight:'600'},comingSoon:{opacity:.6},
  badge:{overflow:'hidden',borderRadius:999,paddingHorizontal:8,paddingVertical:4,fontSize:11,fontWeight:'800'},
  signOut:{minHeight:50,borderWidth:1,borderRadius:9,alignItems:'center',justifyContent:'center',marginTop:24},
  signOutLabel:{fontSize:16,fontWeight:'700'},
});
