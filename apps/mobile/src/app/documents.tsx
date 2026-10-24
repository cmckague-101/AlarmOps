import { useMemo, useState } from 'react';
import { isDocumentUnread, type CompanyDocument } from '@fireops/domain';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeviceSavedList } from '@/components/device-saved-list';
import { deviceDocuments, scopedUserEntries } from '@/lib/offline-user-sync';
import { useOfflineUserSync } from '@/lib/use-offline-user-sync';
import { AppSymbol } from '@/components/app-symbol';
import { deleteCompanyDocument, markCompanyDocumentViewed, refreshDocuments, useCompanyDocuments } from '@/lib/documents-store';
import { openFleetFile } from '@/lib/fleet-files';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export default function CompanyDocumentsScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const canManage = member?.user.role === 'owner' || member?.user.role === 'admin';
  const { documents, loading, refreshing, error } = useCompanyDocuments(member?.company.id ?? null, member?.user.id ?? null);
  // Documents added on this device that the list does not include yet.
  const deviceSync = useOfflineUserSync(member?.company.id, member?.user.id);
  const savedDocuments = useMemo(() => member ? deviceDocuments(scopedUserEntries(deviceSync.entries, member.user.id, member.company.id)).filter((item) => !documents.some((entry) => entry.id === item.id)) : [], [deviceSync.entries, member, documents]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const openDocument = async (document: CompanyDocument) => {
    if (busyId) return;
    setBusyId(document.id);
    setActionError('');
    try {
      const url = await openFleetFile({ name: document.file.name, type: document.file.type, path: document.file.path ?? null });
      await Linking.openURL(url);
      if (member?.user.role !== 'owner' && member?.user.role !== 'admin') await markCompanyDocumentViewed(document.id);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : 'Document could not be opened.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (document: CompanyDocument) => {
    Alert.alert(
      `Delete ${document.name}?`,
      'This permanently removes the document for every crew member.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusyId(document.id);
            setActionError('');
            void deleteCompanyDocument(document)
              .then((cleanupFailed) => {
                if (cleanupFailed) setActionError('Document deleted. Its stored file could not be cleaned up.');
              })
              .catch((deleteError) => setActionError(deleteError instanceof Error ? deleteError.message : 'Document could not be deleted.'))
              .finally(() => setBusyId(null));
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Documents' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshDocuments} tintColor={theme.commandForeground} />}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={1} style={styles.title}>Company Documents</Text>
          </View>
          {canManage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Upload document"
              onPress={() => router.push('/document/form' as never)}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <AppSymbol name={{ ios: 'square.and.arrow.up', android: 'upload' } as never} color="#FFFFFF" size={18} />
              <Text style={styles.addButtonLabel}>Upload</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Available files</Text>
          <Text style={styles.count}>{documents.length}</Text>
        </View>

        {loading ? <Text style={styles.stateText}>Loading company documents…</Text> : null}
        <DeviceSavedList rows={savedDocuments.map((item) => ({ id: item.id, title: item.name, detail: item.fileName, state: item.state }))} />
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Documents unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refreshDocuments} style={styles.retryButton}><Text style={styles.retryLabel}>Try again</Text></Pressable>
          </View>
        ) : null}
        {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}

        {!loading && !error && documents.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><AppSymbol name={{ ios: 'doc.text', android: 'description' } as never} color={theme.secondary} size={28} /></View>
            <Text style={styles.emptyTitle}>No company documents</Text>
            <Text style={styles.emptyText}>{canManage ? 'Upload the first document for crew access.' : 'Your company owner has not uploaded any documents yet.'}</Text>
          </View>
        ) : null}

        {!error && documents.length > 0 ? (
          <View style={styles.list}>
            {documents.map((document, index) => {
              const unread = member ? isDocumentUnread(document, member.user) : false;
              const busy = busyId === document.id;
              return (
                <View key={document.id} style={[styles.row, index > 0 && styles.rowBorder, unread && styles.unreadRow]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${document.name}${unread ? ', new' : ''}`}
                    disabled={Boolean(busyId)}
                    onPress={() => void openDocument(document)}
                    style={({ pressed }) => [styles.openArea, pressed && styles.pressed]}
                  >
                    <View style={[styles.fileIcon, unread && styles.fileIconUnread]}>
                      <AppSymbol name={{ ios: 'doc.fill', android: 'description' } as never} color={unread ? theme.ember : theme.secondary} size={21} />
                    </View>
                    <View style={styles.fileCopy}>
                      <View style={styles.nameLine}>
                        <Text numberOfLines={1} style={styles.documentName}>{document.name}</Text>
                        {unread ? <Text style={styles.newBadge}>New</Text> : null}
                      </View>
                      <Text numberOfLines={1} style={styles.fileName}>{document.file.name}</Text>
                      <Text style={styles.updated}>{busy ? 'Opening…' : `Updated ${formatDate(document.updatedAt)}`}</Text>
                    </View>
                    <AppSymbol name={{ ios: 'arrow.up.right.square', android: 'open_in_new' } as never} color={theme.secondary} size={18} />
                  </Pressable>
                  {canManage ? (
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${document.name}`}
                        disabled={Boolean(busyId)}
                        onPress={() => router.push({ pathname: '/document/form', params: { id: document.id } } as never)}
                        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      >
                        <AppSymbol name={{ ios: 'pencil', android: 'edit' } as never} color={theme.ink} size={18} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${document.name}`}
                        disabled={Boolean(busyId)}
                        onPress={() => confirmDelete(document)}
                        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      >
                        <AppSymbol name={{ ios: 'trash', android: 'delete' } as never} color={theme.danger} size={18} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 22 },
    headingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
    headingCopy: { flex: 1, gap: 6 },
    title: { color: theme.ink, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7 },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 },
    addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 13 },
    addButtonLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 20 },
    sectionTitle: { color: theme.ink, fontSize: 18, lineHeight: 23, fontWeight: '700' },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    stateText: { color: theme.secondary, fontSize: 15, paddingVertical: 24 },
    list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper },
    row: { paddingHorizontal: 13, paddingVertical: 9 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    unreadRow: { backgroundColor: theme.dangerSurface },
    openArea: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 },
    fileIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt },
    fileIconUnread: { backgroundColor: theme.paper },
    fileCopy: { flex: 1, gap: 3 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    documentName: { flexShrink: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    newBadge: { overflow: 'hidden', color: theme.ember, backgroundColor: theme.paper, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
    fileName: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    updated: { color: theme.secondary, fontSize: 11, lineHeight: 16 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 9 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.surfaceAlt },
    empty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 48, gap: 8 },
    emptyIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: theme.surfaceAlt, marginBottom: 5 },
    emptyTitle: { color: theme.ink, fontSize: 20, lineHeight: 26, fontWeight: '700' },
    emptyText: { maxWidth: 310, color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 14, padding: 17, gap: 7 },
    errorTitle: { color: theme.danger, fontSize: 17, fontWeight: '700' },
    errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 },
    retryButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 9, paddingHorizontal: 14 },
    retryLabel: { color: theme.commandText, fontSize: 13, fontWeight: '700' },
    actionError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
    pressed: { opacity: 0.68 },
  });
}
