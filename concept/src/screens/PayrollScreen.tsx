import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import {Card} from '../components/Card';
import {PrimaryButton} from '../components/PrimaryButton';
import {ScreenHeader} from '../components/ScreenHeader';
import {IconButton} from '../components/IconButton';
import {StatusPill} from '../components/StatusPill';
import {seedPayroll} from '../data/seed';
import {PayrollRecord} from '../data/types';
import {loadList, saveList} from '../storage/store';
import {analyzePayrollForm, PayrollAnalysis} from '../services/payrollAnalysis';
import {colors} from '../theme';

const KEY = 'fireops.payroll';
const CURRENT_USER_ID = 'master-1';

export function PayrollScreen() {
  const [items, setItems] = useState<PayrollRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [imageUri, setImageUri] = useState<string>();
  const [analysis, setAnalysis] = useState<PayrollAnalysis>();
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [canReview, setCanReview] = useState(true);

  useEffect(() => {
    Promise.all([loadList(KEY, seedPayroll), AsyncStorage.getItem('fireops.current.permissions.v1')]).then(([records, permissions]) => {
      setItems(records);
      if (permissions) setCanReview((JSON.parse(permissions) as string[]).includes('payrollApprove'));
    }).catch(() => {});
  }, []);

  const visibleItems = useMemo(() => canReview ? items : items.filter(item => item.submitterId === CURRENT_USER_ID), [canReview, items]);

  async function photo() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Camera Permission Required', 'Allow camera access to photograph the payroll form.');
    const result = await ImagePicker.launchCameraAsync({quality: 0.85, allowsEditing: false});
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setImageUri(uri);
    setAnalysis(undefined);
    setConfirmed(false);
    setAnalyzing(true);
    try {
      setAnalysis(await analyzePayrollForm(uri));
    } catch {
      Alert.alert('Analysis Unavailable', 'The payroll form could not be analyzed. Retake the photo and try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function submit() {
    if (!imageUri || !analysis || !confirmed) return Alert.alert('Confirmation Required', 'Photograph the form and confirm the detected total before submitting.');
    const record: PayrollRecord = {
      id: Date.now().toString(), employee: 'Current Employee', assignment: 'Walker Fire', period: 'Current Pay Period',
      hours: analysis.totalHours, days: 0, status: 'Pending', imageUri, submittedAt: new Date().toISOString().slice(0, 10),
      submitterId: CURRENT_USER_ID, routedTo: 'Payroll Administrators', aiConfidence: analysis.confidence, hoursConfirmed: true,
    };
    const next = [record, ...items];
    setItems(next);
    await saveList(KEY, next);
    closeSubmission();
    Alert.alert('Payroll Submitted', 'The form was routed privately to the Master Admin and authorized payroll administrators.');
  }

  function closeSubmission() {
    setOpen(false); setImageUri(undefined); setAnalysis(undefined); setAnalyzing(false); setConfirmed(false);
  }

  return <View style={styles.page}>
    <View style={styles.header}><ScreenHeader title="Payroll" action={<IconButton icon="add" label="Submit Payroll" onPress={() => setOpen(true)}/>} /></View>
    {canReview ? <View style={styles.queueLabel}><Text style={styles.queueTitle}>Admin Review Queue</Text><Text style={styles.queueMeta}>{visibleItems.length} forms</Text></View> : <Card style={styles.privateNotice}><Text style={styles.noticeTitle}>Your Payroll Submissions</Text><Text style={styles.noticeText}>Payroll forms are private. Only you and authorized payroll administrators can access your submissions.</Text></Card>}
    <FlatList contentContainerStyle={styles.list} data={visibleItems} keyExtractor={item => item.id} ListEmptyComponent={<Card><Text style={styles.noticeTitle}>No Payroll Forms</Text><Text style={styles.noticeText}>Submitted forms will appear here for authorized users.</Text></Card>} renderItem={({item}) => <Card style={styles.card}><View style={styles.row}><View style={{flex: 1}}><Text style={styles.name}>{item.employee}</Text><Text style={styles.meta}>{item.assignment} · {item.period}</Text><Text style={styles.meta}>{item.hours} Confirmed Hours</Text>{item.routedTo ? <Text style={styles.routed}>Private · {item.routedTo}</Text> : null}</View><StatusPill status={item.status}/></View>{item.imageUri ? <Image source={{uri: item.imageUri}} style={styles.thumb}/> : null}</Card>}/>
    <Modal visible={open} animationType="slide" onRequestClose={closeSubmission}><View style={styles.modal}><View style={styles.modalHead}><Text style={styles.title}>Submit Payroll</Text><Pressable onPress={closeSubmission}><Text style={styles.cancelTop}>Cancel</Text></Pressable></View><Pressable onPress={photo} style={styles.photo}><Text style={styles.photoText}>{imageUri ? 'Retake Payroll Photo' : 'Take Payroll Photo'}</Text><Text style={styles.photoHint}>Photograph the entire form in clear, even lighting.</Text></Pressable>{imageUri ? <Image source={{uri: imageUri}} style={styles.preview}/> : null}{analyzing ? <Card style={styles.analysisCard}><ActivityIndicator color={colors.red}/><Text style={styles.analysisStatus}>Analyzing Payroll Form…</Text></Card> : analysis ? <Card style={styles.analysisCard}><Text style={styles.analysisEyebrow}>AI Detected Total</Text><Text style={styles.hours}>{analysis.totalHours.toFixed(1)} Hours</Text><Text style={styles.confidence}>{Math.round(analysis.confidence * 100)}% confidence</Text><Text style={styles.prototypeNote}>{analysis.note}</Text><Pressable onPress={() => setConfirmed(!confirmed)} style={[styles.confirm, confirmed && styles.confirmed]}><Text style={styles.confirmText}>{confirmed ? 'Hours Confirmed ✓' : 'Confirm Detected Hours'}</Text></Pressable></Card> : null}<PrimaryButton label="Submit Payroll Privately" onPress={submit} disabled={!confirmed}/></View></Modal>
  </View>;
}

const styles = StyleSheet.create({page:{flex:1,backgroundColor:colors.background},header:{padding:16,paddingBottom:8},queueLabel:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:16,paddingVertical:8},queueTitle:{color:colors.text,fontSize:17,fontWeight:'900'},queueMeta:{color:colors.muted,fontSize:12},privateNotice:{marginHorizontal:16,marginTop:8},noticeTitle:{color:colors.text,fontWeight:'900',fontSize:16},noticeText:{color:colors.muted,lineHeight:19,marginTop:5},list:{padding:16,paddingTop:8,paddingBottom:50,gap:10},card:{marginBottom:10},row:{flexDirection:'row',gap:10,alignItems:'flex-start'},name:{color:colors.text,fontWeight:'900',fontSize:16},meta:{color:colors.muted,marginTop:4},routed:{color:colors.green,fontSize:11,fontWeight:'800',marginTop:7},thumb:{height:130,borderRadius:10,marginTop:12},modal:{flex:1,backgroundColor:colors.background,padding:22,paddingTop:62},modalHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{color:colors.text,fontSize:28,fontWeight:'900'},cancelTop:{color:colors.red,fontWeight:'900'},photo:{borderWidth:1,borderStyle:'dashed',borderColor:colors.muted,borderRadius:14,padding:22,alignItems:'center',marginVertical:22},photoText:{color:colors.text,fontWeight:'900'},photoHint:{color:colors.muted,fontSize:12,marginTop:6,textAlign:'center'},preview:{height:210,borderRadius:12,marginBottom:14},analysisCard:{alignItems:'center',marginBottom:16},analysisStatus:{color:colors.text,fontWeight:'800',marginTop:10},analysisEyebrow:{color:colors.muted,fontSize:11,fontWeight:'900',textTransform:'uppercase'},hours:{color:colors.text,fontSize:32,fontWeight:'900',marginTop:5},confidence:{color:colors.green,fontWeight:'800',marginTop:3},prototypeNote:{color:colors.muted,fontSize:11,lineHeight:16,textAlign:'center',marginTop:9},confirm:{width:'100%',borderWidth:1,borderColor:colors.red,borderRadius:10,paddingVertical:12,alignItems:'center',marginTop:14},confirmed:{backgroundColor:colors.green,borderColor:colors.green},confirmText:{color:colors.text,fontWeight:'900'}});
