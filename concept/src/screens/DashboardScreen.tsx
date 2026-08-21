import React, {useEffect,useState} from 'react';
import {Alert,Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Card} from '../components/Card';
import {StatusBadge} from '../components/StatusBadge';
import {DashboardSection} from '../features/dashboard/DashboardSection';
import {OperationalListItem} from '../features/dashboard/OperationalListItem';
import {OperationalMetricCard} from '../features/dashboard/OperationalMetricCard';
import {NifcSituationTable} from '../features/dashboard/NifcSituationTable';
import {DashboardQuickAction, DashboardQuickActions} from '../features/dashboard/DashboardQuickActions';
import {operationalMetrics, recentActivity, requiredActions} from '../features/dashboard/dashboardData';
import {colors, spacing, typography} from '../theme';
import {PayrollScreen} from './PayrollScreen';
import {ReceiptCaptureScreen} from './ReceiptCaptureScreen';
import {InvoicesScreen} from './InvoicesScreen';
import {AssignmentAvailability,loadAvailability,setAvailability,subscribeAvailability} from '../services/availability';
import {GearCheckoutScreen} from '../features/inventory/GearCheckoutScreen';
import {OperationalDrilldown,OperationalDrilldownId} from '../features/dashboard/OperationalDrilldown';
import {CompanyEvaluations} from '../features/evaluations/CompanyEvaluations';

const CURRENT_USER_ID='master-1';

export function DashboardScreen() {
  const [quickAction, setQuickAction] = useState<DashboardQuickAction | null>(null);
  const [drilldown,setDrilldown]=useState<OperationalDrilldownId|null>(null);
  const [availability,setCurrentAvailability]=useState<AssignmentAvailability>('Unavailable');
  useEffect(()=>{const refresh=()=>loadAvailability().then(records=>setCurrentAvailability(records[CURRENT_USER_ID]?.status||'Unavailable'));refresh();return subscribeAvailability(refresh)},[]);
  const updateAvailability=async(status:AssignmentAvailability)=>{await setAvailability(CURRENT_USER_ID,status);setQuickAction(null);Alert.alert('Availability Updated',`FireCo can now see that you are ${status.toLowerCase()} for assignment.`)};
  const userName = 'Clint';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good Evening';
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <View style={styles.greetingPanel}>
          <View style={styles.greetingAccent}/>
          <View style={styles.greetingCopy}>
            <Text style={styles.greetingLead}>{greeting},</Text>
            <Text style={styles.greetingName}>{userName}!</Text>
          </View>
        </View>
        <Text style={styles.title}>Command Center</Text>
        <Text style={styles.subtitle}>Saturday, July 18 · Current Operational Status</Text>
      </View>
      <StatusBadge label="Live" tone="success"/>
    </View>

    <View style={styles.metrics}>
      {operationalMetrics.map(metric => <OperationalMetricCard key={metric.id} metric={metric} onPress={()=>setDrilldown(metric.id as OperationalDrilldownId)}/>)}
    </View>

    <DashboardSection title="Quick Actions">
      <DashboardQuickActions onSelect={setQuickAction} availability={availability}/>
    </DashboardSection>

    <DashboardSection title="National Fire Activity" detail="NICC daily report">
      <NifcSituationTable/>
    </DashboardSection>

    <DashboardSection title="Required Actions" detail="3 assigned">
      <Card>
        {requiredActions.map((action, index) => <OperationalListItem key={action.id} title={action.title} detail={action.detail} meta={action.due} tone={action.tone} last={index === requiredActions.length - 1}/>)}
      </Card>
    </DashboardSection>

    <DashboardSection title="Recent Operational Activity" detail="Updated moments ago">
      <Card>
        {recentActivity.map((activity, index) => <OperationalListItem key={activity.id} title={activity.title} detail={activity.detail} meta={activity.time} tone={activity.tone} last={index === recentActivity.length - 1}/>)}
      </Card>
    </DashboardSection>
    <Modal visible={!!drilldown} animationType="slide" onRequestClose={()=>setDrilldown(null)}>
      <View style={styles.quickActionModal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to Dashboard" onPress={()=>setDrilldown(null)} style={styles.quickActionBack}>
          <Ionicons name="chevron-back" size={20} color={colors.red}/><Text style={styles.quickActionBackText}>Dashboard</Text>
        </Pressable>
        <View style={styles.quickActionContent}>{drilldown?<OperationalDrilldown id={drilldown}/>:null}</View>
      </View>
    </Modal>
    <Modal visible={!!quickAction} animationType="slide" onRequestClose={() => setQuickAction(null)}>
      <View style={styles.quickActionModal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to Dashboard" onPress={() => setQuickAction(null)} style={styles.quickActionBack}>
          <Ionicons name="chevron-back" size={20} color={colors.red}/><Text style={styles.quickActionBackText}>Dashboard</Text>
        </Pressable>
        <View style={styles.quickActionContent}>
          {quickAction === 'Availability' ? <AvailabilityQuickUpdate status={availability} update={updateAvailability}/> : quickAction === 'Check Out Gear' ? <GearCheckoutScreen/> : quickAction === 'Evaluations' ? <CompanyEvaluations/> : quickAction === 'Payroll' ? <PayrollScreen/> : quickAction === 'Receipts' ? <ReceiptCaptureScreen/> : quickAction === 'Invoices' ? <InvoicesScreen/> : null}
        </View>
      </View>
    </Modal>
  </ScrollView>;
}

function AvailabilityQuickUpdate({status,update}:{status:AssignmentAvailability;update:(status:AssignmentAvailability)=>void}){return <View style={styles.availabilityPage}><View style={[styles.availabilityIcon,status==='Available'?styles.availabilityIconOn:styles.availabilityIconOff]}><Ionicons name={status==='Available'?'checkmark':'remove'} size={34} color={colors.white}/></View><Text style={styles.availabilityTitle}>Assignment Availability</Text><Text style={styles.availabilityStatus}>You Are Currently {status}</Text><Text style={styles.availabilityDetail}>Your selection is shown immediately to the rest of the company in Company Roster.</Text><Pressable style={[styles.availabilityChoice,styles.availableChoice]} onPress={()=>update('Available')}><Ionicons name="checkmark-circle" size={23} color={colors.white}/><Text style={styles.availabilityChoiceText}>Show Me As Available</Text></Pressable><Pressable style={[styles.availabilityChoice,styles.unavailableChoice]} onPress={()=>update('Unavailable')}><Ionicons name="close-circle" size={23} color={colors.white}/><Text style={styles.availabilityChoiceText}>Show Me As Unavailable</Text></Pressable></View>}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: colors.background},
  content: {padding: spacing.screen, paddingBottom: 88},
  header: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md},
  headerCopy: {flex: 1},
  greetingPanel: {flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', marginBottom: spacing.lg},
  greetingAccent: {width: 5, backgroundColor: colors.red},
  greetingCopy: {flex: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  greetingLead: {...typography.bodyStrong, color: colors.textSecondary},
  greetingName: {fontSize: 30, lineHeight: 34, fontWeight: '900', color: colors.text, letterSpacing: 0.2},
  title: {...typography.screenTitle, color: colors.text, marginTop: spacing.xs},
  subtitle: {...typography.body, color: colors.muted, marginTop: spacing.xs},
  metrics: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xl},
  quickActionModal: {flex: 1, backgroundColor: colors.background, paddingTop: 48},
  quickActionBack: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border},
  quickActionBackText: {color: colors.red, fontWeight: '900', fontSize: 16},
  quickActionContent: {flex: 1},
  availabilityPage:{flex:1,padding:spacing.xl,alignItems:'center'},
  availabilityIcon:{width:72,height:72,borderRadius:36,alignItems:'center',justifyContent:'center',marginTop:spacing.xl},
  availabilityIconOn:{backgroundColor:colors.green},
  availabilityIconOff:{backgroundColor:colors.red},
  availabilityTitle:{...typography.screenTitle,color:colors.text,marginTop:spacing.lg,textAlign:'center'},
  availabilityStatus:{...typography.bodyStrong,color:colors.text,marginTop:spacing.sm},
  availabilityDetail:{...typography.body,color:colors.muted,textAlign:'center',marginTop:spacing.sm,marginBottom:spacing.xl},
  availabilityChoice:{width:'100%',borderRadius:14,padding:15,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,marginBottom:spacing.md},
  availableChoice:{backgroundColor:colors.green},
  unavailableChoice:{backgroundColor:colors.red},
  availabilityChoiceText:{color:colors.white,fontWeight:'900'},
});
