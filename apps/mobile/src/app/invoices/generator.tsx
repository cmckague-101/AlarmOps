import {useEffect, useState} from 'react';
import {canProcessFinance} from '@fireops/domain';
import {Redirect, Stack, useRouter} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {InvoiceGeneratorScreen, type GeneratedInvoice} from '@/components/invoice-generator-screen';
import {openFleetFile} from '@/lib/fleet-files';
import {createFleetId} from '@/lib/fleet-store';
import {removeInvoiceFile, uploadInvoiceFile} from '@/lib/invoice-files';
import {addInvoiceCustomer, saveInvoice, useInvoices} from '@/lib/invoice-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function Screen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const {session, access} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const {customers, forms} = useInvoices(member?.company.id ?? null);
  const logoPath = member?.company.logoPath;
  const [logoUri, setLogoUri] = useState('');
  useEffect(() => {
    let active = true;
    setLogoUri('');
    if (logoPath) void openFleetFile({name: 'Company logo', type: 'image/*', path: logoPath})
      .then(url => {if (active) setLogoUri(url);})
      .catch(() => {});
    return () => {active = false;};
  }, [logoPath]);
  if (!session || access.status === 'error') return <Redirect href="/"/>;
  if (!member || !canProcessFinance(member.user.role)) return <Redirect href="/invoices"/>;

  // Creates this user's invoice in progress with the generated PDF attached, then opens it to review and submit.
  const addToInvoices = async (generated: GeneratedInvoice) => {
    if (forms.some(form => form.status === 'draft' && form.createdBy === member.user.id)) throw new Error('Finish or delete your invoice in progress before adding another.');
    const now = new Date().toISOString();
    const draft = await saveInvoice({id: createFleetId(), companyId: member.company.id, createdBy: member.user.id, createdByName: member.user.name, invoiceNumber: generated.invoiceNumber, invoiceDate: generated.invoiceDate, invoiceAmount: generated.amount, customerId: generated.customerId, attachment: null, status: 'draft', submittedAt: null, createdAt: now, updatedAt: now});
    const attachment = await uploadInvoiceFile(member.company.id, member.user.id, draft.id, {uri: generated.pdfUri, name: `Invoice ${generated.invoiceNumber}.pdf`, type: 'application/pdf'});
    try { await saveInvoice({...draft, attachment}); } catch (error) { await removeInvoiceFile(attachment).catch(() => {}); throw error; }
    router.replace({pathname: '/invoices/form', params: {invoiceId: draft.id}} as never);
  };

  return <SafeAreaView style={{flex: 1, backgroundColor: theme.canvas}} edges={['bottom']}>
    <Stack.Screen options={{title: 'Invoice Generator'}}/>
    <InvoiceGeneratorScreen companyLogoUri={logoUri} company={{name: member.company.name, phone: member.company.phone, location: member.company.location}} customers={customers} draftKey={`invoice-generator-draft.${member.company.id}.${member.user.id}`} onAddCustomer={addInvoiceCustomer} onAddToInvoices={addToInvoices}/>
  </SafeAreaView>;
}
