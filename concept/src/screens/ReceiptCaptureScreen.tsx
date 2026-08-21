import React, {useEffect, useState} from 'react';
import {Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {Card} from '../components/Card';
import {PrimaryButton} from '../components/PrimaryButton';
import {ScreenHeader} from '../components/ScreenHeader';
import {IconButton} from '../components/IconButton';
import {StatusPill} from '../components/StatusPill';
import {seedInvoices} from '../data/seed';
import {InvoiceRecord} from '../data/types';
import {loadList, saveList} from '../storage/store';
import {uploadReceiptPhoto} from '../services/receiptCloudStorage';
import {colors} from '../theme';

const KEY = 'fireops.invoices';

export function ReceiptCaptureScreen() {
  const [items, setItems] = useState<InvoiceRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadList(KEY, seedInvoices).then(setItems); }, []);

  async function takeAndUploadPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Camera Access Required', 'Enable camera access to photograph receipts.');
    const result = await ImagePicker.launchCameraAsync({quality: 0.82});
    if (result.canceled) return;
    setUploading(true);
    try {
      const uploaded = await uploadReceiptPhoto(result.assets[0].uri);
      const record: InvoiceRecord = {
        id: Date.now().toString(), vendor: 'Receipt Upload', date: new Date().toISOString().slice(0, 10), amount: 0,
        category: 'Uncategorized', status: 'Pending', imageUri: uploaded.fileUrl, cloudFileId: uploaded.fileId, storageStatus: 'Cloud Stored',
      };
      const next = [record, ...items];
      setItems(next);
      await saveList(KEY, next);
      setOpen(false);
      Alert.alert('Receipt Stored', 'The receipt photo was uploaded directly to cloud storage.');
    } catch (error) {
      Alert.alert('Cloud Upload Failed', error instanceof Error ? error.message : 'The receipt could not be stored. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return <View style={s.page}>
    <View style={s.header}><ScreenHeader title="Receipt Capture" action={<IconButton icon="add" label="Capture Receipt" onPress={() => setOpen(true)}/>} /></View>
    <FlatList contentContainerStyle={s.list} data={items} keyExtractor={item => item.id} renderItem={({item}) => <Card style={s.card}><View style={s.row}><View style={{flex: 1}}><Text style={s.name}>{item.vendor}</Text><Text style={s.meta}>{item.date} · {item.category}</Text>{item.storageStatus ? <Text style={s.cloudStatus}>{item.storageStatus}</Text> : null}</View><StatusPill status={item.status}/></View>{item.imageUri ? <Image source={{uri: item.imageUri}} style={s.thumb}/> : null}</Card>}/>
    <Modal visible={open} animationType="slide" onRequestClose={() => !uploading && setOpen(false)}><View style={s.modal}><View style={s.modalHead}><Text style={s.title}>Capture Receipt</Text><Pressable disabled={uploading} onPress={() => setOpen(false)}><Text style={s.cancel}>Cancel</Text></Pressable></View><PrimaryButton label="Take Receipt Photo" onPress={takeAndUploadPhoto} loading={uploading}/></View></Modal>
  </View>;
}

const s = StyleSheet.create({page:{flex:1,backgroundColor:colors.background},header:{padding:16,paddingBottom:8},list:{padding:16,paddingTop:4},card:{marginBottom:10},row:{flexDirection:'row'},name:{color:colors.text,fontWeight:'900',fontSize:16},meta:{color:colors.muted,marginTop:4},cloudStatus:{color:colors.green,fontSize:11,fontWeight:'900',marginTop:7},thumb:{height:130,borderRadius:10,marginTop:12},modal:{flex:1,backgroundColor:colors.background,padding:22,paddingTop:70},modalHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:30},title:{color:colors.text,fontSize:28,fontWeight:'900'},cancel:{color:colors.red,fontWeight:'900'}});
