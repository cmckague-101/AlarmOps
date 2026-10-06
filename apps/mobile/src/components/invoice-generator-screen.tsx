import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

type LineItem = { id: number; description: string; quantity: string; rate: string };
type Props = { companyLogoUri?: string | null; onBack: () => void };
const item = (id: number): LineItem => ({ id, description: '', quantity: '1', rate: '0.00' });
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

export function InvoiceGeneratorScreen({ companyLogoUri, onBack }: Props) {
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [billFrom, setBillFrom] = useState('');
  const [billTo, setBillTo] = useState('');
  const [logo, setLogo] = useState(companyLogoUri ?? '');
  const [items, setItems] = useState<LineItem[]>([item(1)]);
  const total = useMemo(() => items.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.rate) || 0), 0), [items]);
  const update = (id: number, key: 'description' | 'quantity' | 'rate', value: string) => setItems((rows) => rows.map((row) => row.id === id ? { ...row, [key]: value } : row));

  const chooseLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
    if (!result.canceled) {
      const selected = result.assets[0];
      setLogo(selected.base64 ? `data:${selected.mimeType ?? 'image/jpeg'};base64,${selected.base64}` : selected.uri);
    }
  };

  const generatePdf = async () => {
    try {
      const rows = items.map((row) => `<tr><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.quantity)}</td><td>${money(Number(row.rate) || 0)}</td><td>${money((Number(row.quantity) || 0) * (Number(row.rate) || 0))}</td></tr>`).join('');
      const html = `<!doctype html><html><head><style>body{font:14px Arial;color:#18212f;padding:35px}.head{display:flex;justify-content:space-between;margin-bottom:40px}.logo{max-width:160px;max-height:80px}h1{color:#b42318;margin:0}.right{text-align:right}.parties{display:flex;gap:50px;margin-bottom:30px}.party{width:50%;white-space:pre-wrap}.label{font-size:11px;font-weight:bold;color:#667085;text-transform:uppercase;margin-bottom:8px}table{width:100%;border-collapse:collapse}th{background:#f2f4f7}th,td{padding:11px;border-bottom:1px solid #ddd;text-align:left}th:not(:first-child),td:not(:first-child){text-align:right}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:22px}</style></head><body><div class="head"><div>${logo ? `<img class="logo" src="${escapeHtml(logo)}">` : ''}</div><div class="right"><h1>INVOICE</h1><div># ${escapeHtml(invoiceNumber)}</div><div>${escapeHtml(invoiceDate)}</div></div></div><div class="parties"><div class="party"><div class="label">Bill from</div>${escapeHtml(billFrom)}</div><div class="party"><div class="label">Bill to</div>${escapeHtml(billTo)}</div></div><table><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>${rows}</table><div class="total">Total: ${money(total)}</div></body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${invoiceNumber || ''}`.trim(), UTI: 'com.adobe.pdf' });
      else Alert.alert('Invoice created', `PDF saved to ${uri}`);
    } catch {
      Alert.alert('Could not create invoice', 'Please check invoice details and try again.');
    }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Back to invoices</Text></Pressable>
    <Text style={styles.title}>Invoice Generator</Text><Text style={styles.subtitle}>Create invoice and save it as PDF.</Text>
    <View style={styles.card}>
      <Text style={styles.label}>Invoice date</Text><TextInput style={styles.input} value={invoiceDate} onChangeText={setInvoiceDate} placeholder="YYYY-MM-DD" />
      <Text style={styles.label}>Invoice number</Text><TextInput style={styles.input} value={invoiceNumber} onChangeText={setInvoiceNumber} placeholder="INV-001" />
      <Text style={styles.label}>Bill from</Text><TextInput style={[styles.input, styles.multiline]} multiline value={billFrom} onChangeText={setBillFrom} placeholder={'Company name\nAddress\nEmail'} />
      <Text style={styles.label}>Bill to</Text><TextInput style={[styles.input, styles.multiline]} multiline value={billTo} onChangeText={setBillTo} placeholder={'Customer name\nAddress\nEmail'} />
      <Text style={styles.label}>Company logo</Text><View style={styles.logoRow}>{logo ? <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" /> : null}<Pressable style={styles.secondaryButton} onPress={chooseLogo}><Text style={styles.secondaryText}>Choose logo</Text></Pressable></View>
      <View style={styles.lineHeader}><Text style={styles.sectionTitle}>Line items</Text><Pressable style={styles.secondaryButton} onPress={() => setItems((rows) => [...rows, item(Date.now())])}><Text style={styles.secondaryText}>+ Add item</Text></Pressable></View>
      {items.map((row) => <View key={row.id} style={styles.lineItem}><TextInput style={[styles.input, styles.description]} value={row.description} onChangeText={(value) => update(row.id, 'description', value)} placeholder="Description" /><View style={styles.numberRow}><TextInput style={[styles.input, styles.number]} value={row.quantity} onChangeText={(value) => update(row.id, 'quantity', value)} keyboardType="decimal-pad" placeholder="Qty" /><TextInput style={[styles.input, styles.number]} value={row.rate} onChangeText={(value) => update(row.id, 'rate', value)} keyboardType="decimal-pad" placeholder="Rate" /><Pressable disabled={items.length === 1} onPress={() => setItems((rows) => rows.filter(({ id }) => id !== row.id))}><Text style={[styles.remove, items.length === 1 && styles.disabled]}>Remove</Text></Pressable></View></View>)}
      <Text style={styles.total}>Total: {money(total)}</Text>
      <Pressable style={styles.primaryButton} onPress={generatePdf}><Text style={styles.primaryText}>Generate PDF</Text></Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' }, content: { padding: 20, paddingBottom: 48 }, back: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 8 }, backText: { color: '#344054', fontSize: 15, fontWeight: '600' }, title: { color: '#101828', fontSize: 28, fontWeight: '800' }, subtitle: { color: '#667085', marginTop: 5, marginBottom: 20 }, card: { backgroundColor: '#fff', borderColor: '#e4e7ec', borderWidth: 1, borderRadius: 14, padding: 18 }, label: { color: '#344054', fontWeight: '700', fontSize: 13, marginBottom: 6, marginTop: 14 }, input: { borderColor: '#d0d5dd', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#101828', backgroundColor: '#fff' }, multiline: { minHeight: 90, textAlignVertical: 'top' }, logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, logo: { width: 96, height: 64, borderWidth: 1, borderColor: '#e4e7ec', borderRadius: 8 }, secondaryButton: { borderColor: '#d0d5dd', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 }, secondaryText: { color: '#344054', fontWeight: '700' }, lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 10 }, sectionTitle: { color: '#101828', fontSize: 16, fontWeight: '800' }, lineItem: { gap: 8, marginBottom: 12 }, description: { flex: 1 }, numberRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, number: { flex: 1 }, remove: { color: '#b42318', fontWeight: '700', padding: 5 }, disabled: { opacity: 0.35 }, total: { textAlign: 'right', color: '#101828', fontSize: 20, fontWeight: '800', marginVertical: 20 }, primaryButton: { backgroundColor: '#b42318', borderRadius: 9, padding: 14, alignItems: 'center' }, primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
