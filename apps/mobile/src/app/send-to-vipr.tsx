import { useMemo, useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  canSendToVipr, viprBidPackageFileName, viprBidPackageText, viprCategoryFor, viprExportSummary, viprFieldsFor, viprSelectableVehicles,
  type ViprFieldStatus,
} from '@fireops/domain';

import { AppSymbol } from '@/components/app-symbol';
import { SectionScreen } from '@/components/section-screen';
import { useFleetVehicles } from '@/lib/fleet-store';
import { saveViprBidPackageFile, shareViprBidPackageText, viprVehicle } from '@/lib/vipr-export';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

type Step = 1 | 2 | 3;
const statusLabel: Record<ViprFieldStatus, string> = { mapped: 'Mapped', missing: 'Missing', check: 'Check' };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Fleet → Send to VIPR: select units, review mapped fields, then share or save a text bid package. */
export default function SendToViprScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { vehicles: fleetVehicles, loading } = useFleetVehicles(member?.company.id ?? null);
  const vehicles = useMemo(() => fleetVehicles.map(viprVehicle).sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true })), [fleetVehicles]);
  const { selectable, blocked } = useMemo(() => viprSelectableVehicles(vehicles), [vehicles]);
  const [step, setStep] = useState<Step>(1);
  // null = everything selectable (until the user changes the selection), so late-loading units are included.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = picked ?? new Set(selectable.map((vehicle) => vehicle.id));
  const chosen = selectable.filter((vehicle) => selected.has(vehicle.id));
  const reviewVehicle = chosen[Math.min(reviewIndex, chosen.length - 1)];
  const summary = viprExportSummary(chosen);
  const packageText = step === 3 ? viprBidPackageText(chosen, { companyName: member?.company.name }) : '';

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'idle' || access.status === 'loading') return <SectionScreen title="Send to VIPR" description="Checking fleet access…" />;
  if (!member || !canSendToVipr(member.user.role)) return <Redirect href="/(tabs)/fleet" />;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true); setNote('');
    try { await action(); setNote(done); }
    catch (error) { setNote(error instanceof Error ? error.message : 'The bid package could not be shared.'); }
    finally { setBusy(false); }
  };

  return <>
    <Stack.Screen options={{ title: 'Send to VIPR' }} />
    <SectionScreen title="Send to VIPR" description="Build a bid package from Resources units. VIPR has no import API, so you paste the values into VIPR yourself.">
      <View style={styles.steps} accessibilityRole="summary" accessibilityLabel={`Step ${step} of 3`}>
        {(['Select units', 'Review fields', 'Bid package'] as const).map((label, index) => {
          const number = (index + 1) as Step;
          const done = step > number; const active = step === number;
          return <View key={label} style={styles.step}>
            <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>{done ? <AppSymbol name="checkmark" color={theme.green} size={12} /> : <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{number}</Text>}</View>
            <Text style={[styles.stepLabel, (active || done) && styles.stepLabelActive]}>{label}</Text>
          </View>;
        })}
      </View>

      {step === 1 ? <View style={styles.panel}>
        <View style={styles.toolbar}>
          <Text style={styles.panelTitle}>Choose units for this bid / quote</Text>
          <Text style={styles.muted}>{selected.size} of {selectable.length} selected{blocked.length ? ` · ${blocked.length} blocked` : ''}</Text>
          <View style={styles.toolbarActions}>
            <SmallButton label="Select all" onPress={() => setPicked(new Set(selectable.map((vehicle) => vehicle.id)))} styles={styles} />
            <SmallButton label="Clear" onPress={() => setPicked(new Set())} styles={styles} />
          </View>
        </View>
        {loading && !vehicles.length ? <Text style={styles.muted}>Loading vehicles…</Text> : selectable.length ? <View style={styles.list}>
          {selectable.map((vehicle) => {
            const on = selected.has(vehicle.id);
            const { category, guessed } = viprCategoryFor(vehicle);
            return <Pressable key={vehicle.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(vehicle.id)} style={({ pressed }) => [styles.unitRow, on && styles.unitRowSelected, pressed && styles.pressed]}>
              <View style={[styles.checkbox, on && styles.checkboxOn]}>{on ? <AppSymbol name="checkmark" color="#FFFFFF" size={13} /> : null}</View>
              <View style={styles.unitCopy}>
                <Text style={styles.unitName}>{vehicle.unit}</Text>
                <Text style={styles.muted} numberOfLines={1}>{category}{guessed ? ' (guessed)' : ''} · {vehicle.year || ''} {vehicle.make} {vehicle.model}</Text>
              </View>
              <Text style={[styles.pill, vehicle.status === 'Ready' && styles.pillOk]}>{vehicle.status}</Text>
            </Pressable>;
          })}
        </View> : <Text style={styles.muted}>No units can be sent. Add vehicles in Resources or bring them back into service.</Text>}
        {blocked.length ? <Text accessibilityRole="alert" style={styles.blocked}>{blocked.map((vehicle) => vehicle.unit).join(', ')} can’t be selected while Out of service. Fix in Resources.</Text> : null}
        <Text style={styles.note}>Resources is the single source of truth. Each unit carries one VIPR category in Resources; correct values there, not in the package.</Text>
        <Footer styles={styles} back={{ label: 'Cancel', onPress: () => router.back() }} next={{ label: 'Review fields', disabled: !chosen.length, onPress: () => { setReviewIndex(0); setStep(2); } }} />
      </View> : null}

      {step === 2 && reviewVehicle ? <View style={styles.panel}>
        <View style={styles.toolbar}>
          <Text style={styles.panelTitle}>{reviewVehicle.unit} · {viprCategoryFor(reviewVehicle).category}</Text>
          <Text style={styles.muted}>{reviewIndex + 1} of {chosen.length} units</Text>
          <View style={styles.toolbarActions}>
            <SmallButton label="Open in Resources" onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: reviewVehicle.id } })} styles={styles} />
            <SmallButton label="Previous" disabled={reviewIndex === 0} onPress={() => setReviewIndex((index) => index - 1)} styles={styles} />
            <SmallButton label="Next unit" disabled={reviewIndex >= chosen.length - 1} onPress={() => setReviewIndex((index) => index + 1)} styles={styles} />
          </View>
        </View>
        <View style={styles.list}>
          {viprFieldsFor(reviewVehicle).map((field) => <View key={field.key} style={styles.fieldRow}>
            <View style={styles.unitCopy}>
              <Text style={styles.fieldLabel}>{field.vipr}</Text>
              <Text style={styles.fieldValue} selectable>{field.value}</Text>
              <Text style={styles.muted}>From {field.fireops}</Text>
            </View>
            <Text style={[styles.pill, field.status === 'mapped' ? styles.pillOk : field.status === 'missing' ? styles.pillMissing : styles.pillCheck]}>{statusLabel[field.status]}</Text>
          </View>)}
        </View>
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Export summary</Text>
          <SummaryRow label="Units" value={String(summary.units)} styles={styles} />
          <SummaryRow label="Fields mapped" value={`${summary.mapped} / ${summary.total}`} styles={styles} />
          <SummaryRow label="Missing (required)" value={String(summary.missing)} styles={styles} />
          <SummaryRow label="To check" value={String(summary.check)} styles={styles} />
          {summary.missing ? <Text accessibilityRole="alert" style={styles.alert}>Required fields are missing on one or more units. You can still build the bid package; fill them in Resources before submitting in VIPR.</Text> : null}
        </View>
        <Footer styles={styles} back={{ label: 'Back', onPress: () => setStep(1) }} next={{ label: 'Bid package', onPress: () => { setNote(''); setStep(3); } }} />
      </View> : null}

      {step === 3 ? <View style={styles.panel}>
        <View style={styles.toolbar}>
          <Text style={styles.panelTitle}>Bid package · {plural(chosen.length, 'unit')}</Text>
          <Text style={styles.muted}>Field-by-field in VIPR order. Share it to copy, or save the .txt file to open next to VIPR.</Text>
          <View style={styles.toolbarActions}>
            <SmallButton label="Share text" disabled={busy} onPress={() => void run(() => shareViprBidPackageText(packageText), '')} styles={styles} />
            <SmallButton label="Save .txt file" disabled={busy} onPress={() => void run(() => saveViprBidPackageFile(packageText, viprBidPackageFileName()), `Bid package ready for ${plural(chosen.length, 'unit')}.`)} styles={styles} />
          </View>
        </View>
        <View style={styles.packageBox}><Text style={styles.packageText} selectable>{packageText}</Text></View>
        {note ? <Text accessibilityRole="alert" style={styles.doneNote}>{note}</Text> : null}
        <Footer styles={styles} back={{ label: 'Back', onPress: () => setStep(2) }} next={{ label: 'Done', onPress: () => router.back() }} />
      </View> : null}
    </SectionScreen>
  </>;
}

type Styles = ReturnType<typeof createStyles>;
function SmallButton({ label, disabled, onPress, styles }: { label: string; disabled?: boolean; onPress: () => void; styles: Styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.smallButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.smallButtonLabel}>{label}</Text></Pressable>;
}
function SummaryRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return <View style={styles.summaryRow}><Text style={styles.muted}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}
function Footer({ back, next, styles }: { back: { label: string; onPress: () => void }; next: { label: string; disabled?: boolean; onPress: () => void }; styles: Styles }) {
  return <View style={styles.footer}>
    <Pressable accessibilityRole="button" onPress={back.onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryLabel}>{back.label}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: next.disabled }} disabled={next.disabled} onPress={next.onPress} style={({ pressed }) => [styles.primaryButton, next.disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryLabel}>{next.label}</Text></Pressable>
  </View>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
    step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceAlt },
    stepDotActive: { backgroundColor: theme.ember },
    stepDotDone: { backgroundColor: theme.greenSurface },
    stepNumber: { color: theme.secondary, fontSize: 12, fontWeight: '800' },
    stepNumberActive: { color: '#FFFFFF' },
    stepLabel: { color: theme.secondary, fontSize: 13, fontWeight: '700' },
    stepLabelActive: { color: theme.ink },
    panel: { backgroundColor: theme.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 16, padding: 16, gap: 14 },
    toolbar: { gap: 4 },
    toolbarActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    panelTitle: { color: theme.ink, fontSize: 17, fontWeight: '800' },
    muted: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    list: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 12, overflow: 'hidden' },
    unitRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    unitRowSelected: { backgroundColor: theme.canvas },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.divider, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: theme.ember, borderColor: theme.ember },
    unitCopy: { flex: 1, minWidth: 0, gap: 2 },
    unitName: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    pill: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: theme.surfaceAlt, color: theme.secondary, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
    pillOk: { backgroundColor: theme.greenSurface, color: theme.green },
    pillMissing: { backgroundColor: theme.dangerSurface, color: theme.danger },
    pillCheck: { backgroundColor: theme.warningSurface, color: theme.warning },
    blocked: { color: theme.danger, fontSize: 13, fontWeight: '600' },
    note: { color: theme.ink, fontSize: 13, lineHeight: 18, padding: 12, borderRadius: 10, backgroundColor: theme.canvas, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    fieldLabel: { color: theme.secondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
    fieldValue: { color: theme.ink, fontSize: 15, fontWeight: '700' },
    summary: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: theme.canvas },
    summaryTitle: { color: theme.ink, fontSize: 14, fontWeight: '800' },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
    summaryValue: { color: theme.ink, fontSize: 13, fontWeight: '800' },
    alert: { color: theme.danger, fontSize: 13, lineHeight: 18, padding: 10, borderRadius: 10, backgroundColor: theme.dangerSurface },
    packageBox: { padding: 12, borderRadius: 12, backgroundColor: theme.canvas, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    packageText: { color: theme.ink, fontSize: 12.5, lineHeight: 19, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
    doneNote: { color: theme.green, fontSize: 13, fontWeight: '700', padding: 10, borderRadius: 10, backgroundColor: theme.greenSurface },
    footer: { flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    secondaryButton: { minHeight: 48, minWidth: 96, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 12, paddingHorizontal: 14 },
    secondaryLabel: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    primaryButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember },
    primaryLabel: { color: theme.commandText, fontSize: 15, fontWeight: '800' },
    smallButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper },
    smallButtonLabel: { color: theme.ink, fontSize: 13, fontWeight: '800' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.72 },
  });
}
