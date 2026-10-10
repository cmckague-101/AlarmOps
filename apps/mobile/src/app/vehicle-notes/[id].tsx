import { useCallback, useEffect, useMemo, useState } from "react";
import type { VehicleNote } from "@fireops/domain";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppSymbol } from "@/components/app-symbol";
import { useFleetVehicles } from "@/lib/fleet-store";
import { deleteVehicleNote, listVehicleNotes, saveVehicleNote } from "@/lib/vehicle-notes-store";
import { useSession } from "@/providers/session-provider";
import { FireOpsTheme, useFireOpsTheme } from "@/theme";

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
  const [notes, setNotes] = useState<VehicleNote[]>([]);
  const [editing, setEditing] = useState<VehicleNote | null | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!companyId || !id || user?.role === "fire_fighter") return;
    setLoading(true);
    setError("");
    try { setNotes(await listVehicleNotes(companyId, id)); }
    catch { setError("Vehicle notes could not be loaded."); }
    finally { setLoading(false); }
  }, [companyId, id, user?.role]);

  useEffect(() => { void load(); }, [load]);

  if (!session || access.status === "error") return <Redirect href="/" />;
  if (user?.role === "fire_fighter") return <Redirect href={`/vehicle/${encodeURIComponent(id)}` as never} />;

  const begin = (note?: VehicleNote) => {
    setEditing(note ?? null);
    setSubject(note?.subject ?? "");
    setBody(note?.body ?? "");
    setError("");
  };

  const save = async () => {
    if (!companyId || !user || !id || !subject.trim() || !body.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const note = await saveVehicleNote(companyId, id, user, { id: editing?.id, subject: subject.trim(), body: body.trim() });
      setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      setEditing(undefined);
    } catch { setError("Vehicle note could not be saved. Try again."); }
    finally { setSaving(false); }
  };

  const remove = (note: VehicleNote) => Alert.alert("Delete vehicle note?", `Delete “${note.subject}”? This cannot be undone.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void (async () => {
      if (!companyId) return;
      try { await deleteVehicleNote(companyId, note.id); setNotes((current) => current.filter((item) => item.id !== note.id)); }
      catch { setError("Vehicle note could not be deleted. Try again."); }
    })() },
  ]);

  return <SafeAreaView style={styles.safe} edges={["bottom"]}>
    <Stack.Screen options={{ title: vehicle ? `${vehicle.name} Notes` : "Vehicle Notes" }} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <View><Text accessibilityRole="header" style={styles.title}>Vehicle Notes</Text><Text style={styles.subtitle}>{vehicle?.name ?? "Vehicle"} · {notes.length} {notes.length === 1 ? "note" : "notes"}</Text></View>
        {editing === undefined ? <Pressable accessibilityRole="button" onPress={() => begin()} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><AppSymbol name={{ ios: "plus", android: "add" }} size={18} color="#fff" /><Text style={styles.addLabel}>New note</Text></Pressable> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {editing !== undefined ? <View style={styles.form}>
        <Text style={styles.label}>Subject</Text><TextInput value={subject} onChangeText={setSubject} maxLength={160} autoFocus style={styles.input} placeholder="Note subject" placeholderTextColor={theme.secondary} />
        <Text style={styles.label}>Body</Text><TextInput value={body} onChangeText={setBody} maxLength={5000} multiline textAlignVertical="top" style={[styles.input, styles.bodyInput]} placeholder="Add note details" placeholderTextColor={theme.secondary} />
        <View style={styles.formActions}><Pressable onPress={() => setEditing(undefined)} style={styles.cancelButton}><Text style={styles.cancelLabel}>Cancel</Text></Pressable><Pressable disabled={saving || !subject.trim() || !body.trim()} onPress={() => void save()} style={[styles.saveButton, (saving || !subject.trim() || !body.trim()) && styles.disabled]}><Text style={styles.saveLabel}>{saving ? "Saving…" : editing ? "Save changes" : "Create note"}</Text></Pressable></View>
      </View> : loading ? <ActivityIndicator color={theme.ember} /> : notes.length ? <View style={styles.list}>{notes.map((note) => <View key={note.id} style={styles.card}>
        <View style={styles.cardTop}><View style={styles.cardCopy}><Text style={styles.date}>{new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Text><Text style={styles.subject}>{note.subject}</Text></View><View style={styles.actions}><Pressable accessibilityLabel={`Edit ${note.subject}`} onPress={() => begin(note)} style={styles.iconButton}><AppSymbol name={{ ios: "pencil", android: "edit" }} size={17} color={theme.ember} /></Pressable><Pressable accessibilityLabel={`Delete ${note.subject}`} onPress={() => remove(note)} style={styles.iconButton}><AppSymbol name={{ ios: "trash", android: "delete" }} size={17} color={theme.danger} /></Pressable></View></View>
        <Text numberOfLines={3} style={styles.preview}>{note.body}</Text><Text style={styles.byline}>{note.createdBy}{note.updatedAt !== note.createdAt ? " · Edited" : ""}</Text>
      </View>)}</View> : <View style={styles.empty}><AppSymbol name={{ ios: "note.text", android: "notes" }} size={34} color={theme.secondary} /><Text style={styles.emptyTitle}>No vehicle notes</Text><Text style={styles.subtitle}>Create first note for this vehicle.</Text></View>}
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) { return StyleSheet.create({
  safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:16},heading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},title:{fontSize:27,fontWeight:"800",color:theme.ink},subtitle:{marginTop:4,fontSize:13,color:theme.secondary},addButton:{minHeight:44,flexDirection:"row",alignItems:"center",gap:6,borderRadius:10,backgroundColor:theme.ember,paddingHorizontal:13},addLabel:{color:"#fff",fontWeight:"700"},error:{color:theme.danger,fontSize:13},form:{gap:8,padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},label:{marginTop:4,fontSize:12,fontWeight:"700",color:theme.ink},input:{minHeight:46,borderWidth:1,borderColor:theme.divider,borderRadius:9,paddingHorizontal:12,color:theme.ink,backgroundColor:theme.canvas},bodyInput:{height:150,paddingTop:12},formActions:{flexDirection:"row",justifyContent:"flex-end",gap:9,marginTop:8},cancelButton:{minHeight:44,justifyContent:"center",paddingHorizontal:16,borderWidth:1,borderColor:theme.divider,borderRadius:9},cancelLabel:{color:theme.ink,fontWeight:"700"},saveButton:{minHeight:44,justifyContent:"center",paddingHorizontal:16,borderRadius:9,backgroundColor:theme.ember},saveLabel:{color:"#fff",fontWeight:"700"},disabled:{opacity:.45},list:{gap:11},card:{padding:15,borderWidth:1,borderColor:theme.divider,borderRadius:13,backgroundColor:theme.paper},cardTop:{flexDirection:"row",alignItems:"flex-start",gap:10},cardCopy:{flex:1},date:{fontSize:11,color:theme.secondary},subject:{marginTop:4,fontSize:16,fontWeight:"700",color:theme.ink},actions:{flexDirection:"row",gap:6},iconButton:{width:40,height:40,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:theme.divider,borderRadius:9},preview:{marginTop:11,fontSize:13,lineHeight:20,color:theme.ink},byline:{marginTop:8,fontSize:11,color:theme.secondary},empty:{alignItems:"center",paddingVertical:60},emptyTitle:{marginTop:12,fontSize:17,fontWeight:"700",color:theme.ink},pressed:{opacity:.72},
}); }
