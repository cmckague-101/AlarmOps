import {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {canManageIntegrations, integrationCatalog, maskSecret, type IntegrationProvider, type PublicIntegration} from '@fireops/domain';
import {SectionScreen} from '@/components/section-screen';
import {useIntegrationVault} from '@/lib/integration-vault';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme, type FireOpsTheme} from '@/theme';

const statusLabel = {connected: 'Connected', disconnected: 'Disconnected', error: 'Needs attention'} as const;

export default function IntegrationsScreen() {
  const theme = useFireOpsTheme();
  const styles = stylesFor(theme);
  const {access} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const vault = useIntegrationVault();
  const [records, setRecords] = useState(() => vault.list());
  const [audit, setAudit] = useState(() => vault.audit());
  const [editing, setEditing] = useState<IntegrationProvider | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!member || !canManageIntegrations(member.user.role)) return <SectionScreen title="API keys" description="Only a company owner or admin can manage integration credentials."/>;
  const actor = member.user.name;
  const refresh = () => { setRecords(vault.list()); setAudit(vault.audit()); };
  const run = async (action: () => Promise<void>) => {
    setError('');
    try { await action(); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The credential change could not be saved.'); }
  };
  return <SectionScreen title="API keys" description="Secrets are sealed in this session and only the last four characters are shown. A signed-in company stores them encrypted on the server.">
    {message ? <Text style={styles.ok}>{message}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {records.map(record => <View key={record.provider} style={styles.card}>
      <Text style={styles.title}>{record.title}</Text>
      <Text style={styles.meta}>{statusLabel[record.status]} · {integrationCatalog[record.provider].summary}</Text>
      {record.secrets.map(secret => <Text key={secret.field} style={styles.meta}>{fieldLabel(record.provider, secret.field)} {maskSecret(secret.lastFour).display}</Text>)}
      {Object.entries(record.publicConfig).map(([field, value]) => <Text key={field} style={styles.meta}>{fieldLabel(record.provider, field)}: {value}</Text>)}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => setEditing(record.provider)} style={styles.secondary}><Text style={styles.secondaryLabel}>{record.updatedAt ? 'Edit' : 'Add'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!record.updatedAt} onPress={() => void run(async () => { const result = await vault.test(record.provider, actor); setMessage(result.message); })} style={styles.secondary}><Text style={styles.secondaryLabel}>Test connection</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!record.updatedAt} onPress={() => void run(async () => { await vault.remove(record.provider, actor); setMessage(`${record.title} credentials were deleted.`); })} style={styles.secondary}><Text style={styles.secondaryLabel}>Delete</Text></Pressable>
      </View>
      {editing === record.provider && <CredentialForm provider={record.provider} existing={record} onSave={values => void run(async () => { await vault.save(record.provider, values, actor); setEditing(null); setMessage(`${record.title} credentials were saved.`); })}/>}
    </View>)}
    <Text style={styles.title}>Credential changes</Text>
    {audit.length ? audit.map(entry => <Text key={entry.id} style={styles.meta}>{entry.summary}</Text>) : <Text style={styles.meta}>No credential changes yet.</Text>}
  </SectionScreen>;
}

function CredentialForm({provider, existing, onSave}: {provider: IntegrationProvider; existing: PublicIntegration; onSave: (values: Record<string, string>) => void}) {
  const theme = useFireOpsTheme();
  const styles = stylesFor(theme);
  const [values, setValues] = useState<Record<string, string>>({...existing.publicConfig});
  return <View style={styles.form}>
    {integrationCatalog[provider].fields.map(field => <View key={field.id}>
      <Text style={styles.meta}>{field.label}</Text>
      <TextInput accessibilityLabel={field.label} autoCapitalize="none" autoCorrect={false} secureTextEntry={field.kind === 'secret'} value={values[field.id] ?? ''} placeholder={field.kind === 'secret' && existing.secrets.some(secret => secret.field === field.id) ? 'Leave blank to keep the saved secret' : field.choices?.[0]?.label} placeholderTextColor={theme.secondary} onChangeText={text => setValues(current => ({...current, [field.id]: text}))} style={styles.input}/>
    </View>)}
    <Pressable accessibilityRole="button" onPress={() => onSave(values)} style={styles.primary}><Text style={styles.primaryLabel}>Save</Text></Pressable>
  </View>;
}

function fieldLabel(provider: IntegrationProvider, id: string) {
  return integrationCatalog[provider].fields.find(field => field.id === id)?.label ?? id;
}

function stylesFor(theme: FireOpsTheme) {
  return StyleSheet.create({
    card: {backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 14, padding: 14, gap: 6, marginBottom: 12},
    title: {color: theme.ink, fontSize: 17, fontWeight: '800'},
    meta: {color: theme.secondary, fontSize: 13, lineHeight: 18},
    actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8},
    secondary: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper},
    secondaryLabel: {color: theme.ink, fontWeight: '700'},
    primary: {minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember},
    primaryLabel: {color: '#fff', fontWeight: '700'},
    form: {gap: 8, marginTop: 8},
    input: {minHeight: 44, borderWidth: 1, borderColor: theme.divider, borderRadius: 8, paddingHorizontal: 12, color: theme.ink, backgroundColor: theme.paper, fontSize: 16},
    ok: {color: theme.green, fontWeight: '700', marginBottom: 8},
    error: {color: theme.danger, marginBottom: 8},
  });
}
