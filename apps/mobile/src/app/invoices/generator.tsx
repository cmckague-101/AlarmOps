import {useEffect, useState} from 'react';
import {canProcessFinance} from '@fireops/domain';
import {Redirect, Stack, useRouter} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {InvoiceGeneratorScreen} from '@/components/invoice-generator-screen';
import {openFleetFile} from '@/lib/fleet-files';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function Screen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const {session, access} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
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
  return <SafeAreaView style={{flex: 1, backgroundColor: theme.canvas}} edges={['bottom']}>
    <Stack.Screen options={{title: 'Invoice Generator'}}/>
    <InvoiceGeneratorScreen companyLogoUri={logoUri} onBack={() => router.back()}/>
  </SafeAreaView>;
}
