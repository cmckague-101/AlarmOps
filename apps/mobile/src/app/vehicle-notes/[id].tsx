import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import { formatCalendarDate, nextOilChangeWarning, type VehicleNote } from "@fireops/domain";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppSymbol } from "@/components/app-symbol";
import { assertFleetRecordVersion, createFleetId, fleetReadVersion, saveFleetRecord, useFleetVehicles } from "@/lib/fleet-store";
import { deleteVehicleNote, listVehicleNotes, saveVehicleNote } from "@/lib/vehicle-notes-store";
import { deviceVehicleNotes, scopedUserEntries, type DeviceVehicleNote } from "@/lib/offline-user-sync";
import { useOptionalOfflineSync } from "@/providers/offline-sync-provider";
import { useOfflineEdits } from "@/lib/use-offline-edits";
import { useSession } from "@/providers/session-provider";
import { FireOpsTheme, useFireOpsTheme } from "@/theme";

const noteCommands = { update: "note.update", delete: "note.delete" };
const applyNote = (note: VehicleNote, changes: Record<string, unknown>): VehicleNote => ({ ...note, subject: (changes.subject as string) ?? note.subject, body: (changes.body as string) ?? note.body });
const formatObserved = (value?: string | null) => {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function VehicleNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const account = access.value?.kind === "member" ? access.value : null;
  const companyId = account?.company.id ?? null;
  const user = account?.user ?? null;
  const { vehicles } = useFleetVehicles(companyId);
  const vehicle = vehicles.find((item) => item.id === id);
  const diagnostics = vehicle?.motive?.diagnostics;
  const [notes, setNotes] = useState<VehicleNote[]>([]);
  const [editing, setEditing] = useState<VehicleNote | null | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [oilChange, setOilChange] = useState("");
  const [oilDue, setOilDue] = useState("");
  const [oilPickerOpen, setOilPickerOpen] = useState(false);
  const [savingOil, setSavingOil] = useState(false);
  const oilWarning = nextOilChangeWarning({ nextOilChange: oilChange, nextOilChangeDue: oilDue });
  // Offline: new notes save on the device; edits and deletes need a connection.
  const offlineSync = useOptionalOfflineSync();
  const offline = !!offlineSync?.offline;
  const userSync = offlineSync?.userSync && offlineSync.userSync.scope.companyId === companyId && offlineSync.userSync.scope.userId === user?.id ? offlineSync.userSync : null;
  const deviceNotes = useMemo(() => companyId && user && id ? deviceVehicleNotes(scopedUserEntries(offlineSync?.state.entries ?? [], user.id, companyId), id) : [], [offlineSync?.state.entries, companyId, user, id]);
  const deviceState = useMemo(() => new Map<string, DeviceVehicleNote["state"]>(deviceNotes.map((note) => [note.id, note.state])), [deviceNotes]);
  const shown = useMemo(() => [...notes, ...deviceNotes.filter((note) => !notes.some((item) => item.id === note.id)).map((note): VehicleNote => ({
    id: note.id, vehicleId: note.vehicleId, subject: note.subject, body: note.body, createdBy: user?.name ?? "You", createdById: user?.id ?? "",
    createdAt: note.createdAt ?? note.savedAt, updatedAt: note.createdAt ?? note.savedAt,
  }))].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [notes, deviceNotes, user]);
  // Offline edits/deletes saved on this device are shown on top; each applies only to an unchanged note.
  const editMember = useMemo(() => companyId && user ? { company: { id: companyId }, user: { id: user.id } } : null, [companyId, user]);
  const edits = useOfflineEdits(shown, editMember, "vehicle_note", noteCommands, applyNote);
  const visible = edits.items;
  const seenVersion = (note: VehicleNote) => ({ updatedAt: notes.find((item) => item.id === note.id)?.updatedAt ?? note.updatedAt });
  // One client ID per intended note, reused when a failed device save is retried.
  const offlineIds = useRef(new Map<string, string>());

  useEffect(() => {
    setOilChange(vehicle?.nextOilChange ?? "");
    setOilDue(vehicle?.nextOilChangeDue ?? "");
  }, [vehicle?.id, vehicle?.nextOilChange, vehicle?.nextOilChangeDue]);

  const load = useCallback(async () => {
    if (!companyId || !id || (user?.role === "fire_fighter" || user?.role === "accounting")) return;
    setLoading(true);
    setError("");
    try { setNotes(await listVehicleNotes(companyId, id)); }
    catch { setError("Service repairs could not be loaded."); }
    finally { setLoading(false); }
  }, [companyId, id, user?.role]);

  useEffect(() => { void load(); }, [load]);

  if (!session || access.status === "error") return <Redirect href="/" />;
  if ((user?.role === "fire_fighter" || user?.role === "accounting")) return <Redirect href={`/vehicle/${encodeURIComponent(id)}` as never} />;

  const begin = (note?: VehicleNote) => {
    setEditing(note ?? null);
    setSubject(note?.subject ?? "");
    setBody(note?.body ?? "");
    setError("");
  };

  // Only the two oil change fields change, so shop techs can save them too.
  // Online only: the server checks the vehicle version before saving.
  const saveOilChange = async (patch: { nextOilChange?: string; nextOilChangeDue?: string }) => {
    if (!companyId || !user || !vehicle || savingOil) return;
    const currentText = vehicle.nextOilChange ?? "";
    const currentDue = vehicle.nextOilChangeDue ?? "";
    const nextText = (patch.nextOilChange ?? currentText).trim();
    const nextDue = (patch.nextOilChangeDue ?? currentDue).trim();
    if (nextText === currentText && nextDue === currentDue) return;
    setSavingOil(true);
    setError("");
    try {
      if (offline) throw new Error("Saving the next oil change needs a connection.");
      const version = fleetReadVersion(vehicle, "vehicles");
      assertFleetRecordVersion("vehicles", vehicle.id, version);
      const { nextOilChange: _text, nextOilChangeDue: _due, ...rest } = vehicle.source;
      await saveFleetRecord("vehicles", {
        ...rest,
        id: vehicle.id,
        ...(nextText ? { nextOilChange: nextText } : {}),
        ...(nextDue ? { nextOilChangeDue: nextDue } : {}),
      }, { version, companyId, userId: user.id });
      setOilChange(nextText);
      setOilDue(nextDue);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Next oil change could not be saved.");
      setOilChange(currentText);
      setOilDue(currentDue);
    } finally {
      setSavingOil(false);
    }
  };

  const save = async () => {
    if (!companyId || !user || !id || !subject.trim() || !body.trim() || saving) return;
    setSaving(true);
    setError("");
    if (offline) {
      try {
        if (!userSync) throw new Error("Logging repairs offline is unavailable on this device.");
        if (editing) {
          await userSync.updateVehicleNote(editing.id, { subject, body }, edits.baseFor(editing.id, seenVersion(editing)));
          setEditing(undefined);
          return;
        }
        const key = `${companyId}:${user.id}:${id}:${subject.trim()}:${body.trim()}`;
        const noteId = offlineIds.current.get(key) ?? createFleetId();
        offlineIds.current.set(key, noteId);
        await userSync.createVehicleNote({ id: noteId, vehicleId: id, subject, body });
        offlineIds.current.delete(key);
        setEditing(undefined);
      } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Repair log could not be saved on this device."); }
      finally { setSaving(false); }
      return;
    }
    try {
      const note = await saveVehicleNote(companyId, id, user, { id: editing?.id, subject: subject.trim(), body: body.trim() });
      setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      setEditing(undefined);
    } catch { setError("Repair log could not be saved. Try again."); }
    finally { setSaving(false); }
  };

  const remove = (note: VehicleNote) => Alert.alert("Delete repair log?", `Delete “${note.subject}”? This cannot be undone.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void (async () => {
      if (!companyId) return;
      try {
        if (offline) {
          if (!userSync) throw new Error("Deleting repairs offline is unavailable on this device.");
          await userSync.deleteVehicleNote(note.id, edits.baseFor(note.id, seenVersion(note)));
        } else { await deleteVehicleNote(companyId, note.id); setNotes((current) => current.filter((item) => item.id !== note.id)); }
      }
      catch { setError("Repair log could not be deleted. Try again."); }
    })() },
  ]);

  return <SafeAreaView style={styles.safe} edges={["bottom"]}>
    <Stack.Screen options={{ title: vehicle ? `${vehicle.name} Service` : "Service" }} />
    <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <View><Text accessibilityRole="header" style={styles.title}>Service</Text><Text style={styles.subtitle}>{vehicle?.name ?? "Vehicle"} · {visible.length} {visible.length === 1 ? "repair" : "repairs"} logged</Text></View>
        {editing === undefined ? <Pressable accessibilityRole="button" onPress={() => begin()} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><AppSymbol name={{ ios: "plus", android: "add" }} size={18} color="#fff" /><Text style={styles.addLabel}>Log repair</Text></Pressable> : null}
      </View>
      {oilWarning ? (
        <View accessibilityRole="alert" style={styles.oilAlert}>
          <AppSymbol name={{ ios: "exclamationmark.triangle.fill", android: "warning" } as never} size={17} color={theme.warning} />
          <View style={styles.oilAlertCopy}>
            <Text style={styles.oilAlertTitle}>Needs attention</Text>
            <Text style={styles.oilAlertText}>Oil change is due{oilWarning.note ? ` · ${oilWarning.note}` : ""} · {formatCalendarDate(oilWarning.due)}</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.oilCard}>
        <Text style={styles.label}>Next oil change</Text>
        <TextInput
          value={oilChange}
          onChangeText={setOilChange}
          onBlur={() => void saveOilChange({ nextOilChange: oilChange })}
          maxLength={120}
          editable={!savingOil && !!vehicle}
          placeholder="e.g. 45,000 mi or 250 hrs"
          placeholderTextColor={theme.secondary}
          style={styles.input}
        />
        <Text style={styles.label}>Due date</Text>
        <View style={styles.oilDueRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={oilDue ? `Oil change due date, ${formatCalendarDate(oilDue)}` : "Select oil change due date"} disabled={savingOil || !vehicle} onPress={() => setOilPickerOpen((open) => !open)} style={[styles.cancelButton, styles.oilDueButton]}>
            <Text style={styles.cancelLabel}>{oilDue ? formatCalendarDate(oilDue) : "Select due date"}</Text>
          </Pressable>
          {oilDue ? <Pressable accessibilityRole="button" accessibilityLabel="Clear oil change due date" disabled={savingOil} onPress={() => { setOilPickerOpen(false); void saveOilChange({ nextOilChangeDue: "" }); }} style={styles.cancelButton}><Text style={styles.cancelLabel}>Clear</Text></Pressable> : null}
        </View>
        {oilPickerOpen ? <>
          <DateTimePicker value={oilDue ? new Date(`${oilDue}T12:00:00`) : new Date()} mode="date" display={Platform.OS === "ios" ? "inline" : "default"} onChange={(event, date) => {
            if (Platform.OS !== "ios") setOilPickerOpen(false);
            if (event.type !== "set" || !date) return;
            const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            setOilDue(value);
            void saveOilChange({ nextOilChangeDue: value });
          }} />
          {Platform.OS === "ios" ? <Pressable accessibilityRole="button" onPress={() => setOilPickerOpen(false)} style={styles.cancelButton}><Text style={styles.cancelLabel}>Done</Text></Pressable> : null}
        </> : null}
        {savingOil ? <Text style={styles.savingOil}>Saving…</Text> : null}
      </View>
      {diagnostics !== undefined ? (
        <View accessibilityLabel={diagnostics.length ? `${diagnostics.length} open diagnostic codes` : "No open diagnostic codes"} style={[styles.diagnostics, !diagnostics.length && styles.diagnosticsClearCard]}>
          <View style={styles.diagnosticsHeading}>
            <AppSymbol name={diagnostics.length ? ({ ios: "exclamationmark.triangle.fill", android: "warning" } as never) : ({ ios: "checkmark.circle.fill", android: "check_circle" } as never)} color={diagnostics.length ? theme.danger : "#1F7A4D"} size={17} />
            <Text style={[styles.diagnosticsTitle, !diagnostics.length && styles.diagnosticsClear]}>{diagnostics.length ? "Open diagnostic codes" : "No open diagnostic codes"}</Text>
            {diagnostics.length ? <Text style={styles.diagnosticsCount}>{diagnostics.length}</Text> : null}
          </View>
          {diagnostics.map((code) => (
            <View key={code.id} style={styles.diagnosticRow}>
              <Text style={styles.diagnosticCode}>{code.label}</Text>
              <Text style={styles.diagnosticDescription}>{code.description || "Description unavailable"}</Text>
              <Text style={styles.diagnosticDate}>Last observed {formatObserved(code.lastObservedAt)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {editing !== undefined ? <View style={styles.form}>
        <Text style={styles.label}>Subject</Text><TextInput value={subject} onChangeText={setSubject} maxLength={160} autoFocus style={styles.input} placeholder="e.g. Replaced alternator" placeholderTextColor={theme.secondary} />
        <Text style={styles.label}>Details</Text><TextInput value={body} onChangeText={setBody} maxLength={5000} multiline textAlignVertical="top" style={[styles.input, styles.bodyInput]} placeholder="Describe the repair work completed" placeholderTextColor={theme.secondary} />
        <View style={styles.formActions}><Pressable onPress={() => setEditing(undefined)} style={styles.cancelButton}><Text style={styles.cancelLabel}>Cancel</Text></Pressable><Pressable disabled={saving || !subject.trim() || !body.trim()} onPress={() => void save()} style={[styles.saveButton, (saving || !subject.trim() || !body.trim()) && styles.disabled]}><Text style={styles.saveLabel}>{saving ? "Saving…" : editing ? "Save changes" : "Log repair"}</Text></Pressable></View>
      </View> : loading ? <ActivityIndicator color={theme.ember} /> : visible.length ? <View style={styles.list}>{visible.map((note) => <View key={note.id} style={styles.card}>
        <View style={styles.cardTop}><View style={styles.cardCopy}><Text style={styles.date}>{new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Text><Text style={styles.subject}>{note.subject}</Text></View>{offline || deviceState.has(note.id) ? null : <View style={styles.actions}><Pressable accessibilityLabel={`Edit ${note.subject}`} onPress={() => begin(note)} style={styles.iconButton}><AppSymbol name={{ ios: "pencil", android: "edit" }} size={17} color={theme.ember} /></Pressable><Pressable accessibilityLabel={`Delete ${note.subject}`} onPress={() => remove(note)} style={styles.iconButton}><AppSymbol name={{ ios: "trash", android: "delete" }} size={17} color={theme.danger} /></Pressable></View>}</View>
        <Text numberOfLines={3} style={styles.preview}>{note.body}</Text><Text style={styles.byline}>{deviceState.get(note.id) === "saved" ? "Saved on this device — syncs when connected" : deviceState.get(note.id) === "action_needed" ? "Saved on this device — action needed in Saved changes & sync" : `${note.createdBy}${note.updatedAt !== note.createdAt ? " · Edited" : ""}`}</Text>
      </View>)}</View> : <View style={styles.empty}><AppSymbol name={{ ios: "wrench.and.screwdriver", android: "build" }} size={34} color={theme.secondary} /><Text style={styles.emptyTitle}>No repairs logged</Text><Text style={styles.subtitle}>Log the first repair for this vehicle.</Text></View>}
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) { return StyleSheet.create({
  safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:16},heading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},title:{fontSize:27,fontWeight:"800",color:theme.ink},subtitle:{marginTop:4,fontSize:13,color:theme.secondary},addButton:{minHeight:44,flexDirection:"row",alignItems:"center",gap:6,borderRadius:10,backgroundColor:theme.ember,paddingHorizontal:13},addLabel:{color:"#fff",fontWeight:"700"},error:{color:theme.danger,fontSize:13},oilCard:{gap:8,padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},savingOil:{fontSize:12,color:theme.secondary},oilDueRow:{flexDirection:"row",gap:8,flexWrap:"wrap"},oilDueButton:{flexGrow:1},oilAlert:{flexDirection:"row",alignItems:"flex-start",gap:10,padding:14,borderRadius:12,backgroundColor:theme.warningSurface},oilAlertCopy:{flex:1,gap:2},oilAlertTitle:{fontSize:14,fontWeight:"800",color:theme.warning},oilAlertText:{fontSize:13,color:theme.ink},  diagnostics:{gap:8,padding:16,borderWidth:1,borderColor:theme.danger,borderRadius:14,backgroundColor:theme.paper},diagnosticsClearCard:{borderColor:theme.divider},diagnosticsHeading:{flexDirection:"row",alignItems:"center",gap:7},diagnosticsTitle:{flex:1,color:theme.danger,fontSize:12,fontWeight:"800",textTransform:"uppercase"},diagnosticsClear:{color:"#1F7A4D"},diagnosticsCount:{minWidth:24,borderRadius:12,backgroundColor:theme.canvas,color:theme.danger,paddingHorizontal:7,paddingVertical:2,textAlign:"center",fontSize:11,fontWeight:"800"},diagnosticRow:{gap:2,borderRadius:8,backgroundColor:theme.canvas,padding:10,borderWidth:1,borderColor:theme.divider},diagnosticCode:{color:theme.danger,fontSize:13,fontWeight:"800"},diagnosticDescription:{color:theme.ink,fontSize:12,lineHeight:17},diagnosticDate:{color:theme.secondary,fontSize:10},form:{gap:8,padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},label:{marginTop:4,fontSize:12,fontWeight:"700",color:theme.ink},input:{minHeight:46,borderWidth:1,borderColor:theme.divider,borderRadius:9,paddingHorizontal:12,color:theme.ink,backgroundColor:theme.canvas},bodyInput:{height:150,paddingTop:12},formActions:{flexDirection:"row",justifyContent:"flex-end",gap:9,marginTop:8},cancelButton:{minHeight:44,justifyContent:"center",paddingHorizontal:16,borderWidth:1,borderColor:theme.divider,borderRadius:9},cancelLabel:{color:theme.ink,fontWeight:"700"},saveButton:{minHeight:44,justifyContent:"center",paddingHorizontal:16,borderRadius:9,backgroundColor:theme.ember},saveLabel:{color:"#fff",fontWeight:"700"},disabled:{opacity:.45},list:{gap:11},card:{padding:15,borderWidth:1,borderColor:theme.divider,borderRadius:13,backgroundColor:theme.paper},cardTop:{flexDirection:"row",alignItems:"flex-start",gap:10},cardCopy:{flex:1},date:{fontSize:11,color:theme.secondary},subject:{marginTop:4,fontSize:16,fontWeight:"700",color:theme.ink},actions:{flexDirection:"row",gap:6},iconButton:{width:40,height:40,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:theme.divider,borderRadius:9},preview:{marginTop:11,fontSize:13,lineHeight:20,color:theme.ink},byline:{marginTop:8,fontSize:11,color:theme.secondary},empty:{alignItems:"center",paddingVertical:60},emptyTitle:{marginTop:12,fontSize:17,fontWeight:"700",color:theme.ink},pressed:{opacity:.72},
}); }
