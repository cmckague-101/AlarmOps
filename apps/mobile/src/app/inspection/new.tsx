import { useEffect, useMemo, useRef, useState } from "react";
import { canInspectVehicle, vehicleSlotFileValue, type AttachmentUploadManifest, type SyncRecord, type VehicleInspection } from "@fireops/domain";
import * as ImagePicker from "expo-image-picker";
import { Redirect, Stack, useLocalSearchParams, usePreventRemove, useRouter } from "expo-router";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { uploadFleetFile, removeFleetFiles } from "@/lib/fleet-files";
import { createFleetId, saveFleetInspection, useFleetVehicles, type FleetVehicleFile } from "@/lib/fleet-store";
import { useInspectionTemplate } from "@/lib/inspection-template-store";
import { useSession } from "@/providers/session-provider";
import { useOfflineSync } from "@/providers/offline-sync-provider";
import { createDetailChangeActions } from "@/lib/offline-attachment-actions";
import { FireOpsTheme, useFireOpsTheme } from "@/theme";

type CheckItem = VehicleInspection["items"][number];

export default function NewInspectionScreen() {
  const { vehicleId = "" } = useLocalSearchParams<{ vehicleId?: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === "member" ? access.value.company.id : null;
  const user = access.value?.kind === "member" ? access.value.user : null;
  const { vehicles, loading } = useFleetVehicles(companyId);
  const { items: templateItems, loading: templateLoading, error: templateError } = useInspectionTemplate(companyId);
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  const [assignmentIncident, setAssignmentIncident] = useState("");
  const [items, setItems] = useState<CheckItem[]>([]);
  const templateInitialized = useRef(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const uploadedPaths = useRef(new Set<string>());
  const saved = useRef(false);
  // Offline: photos are staged on device and the inspection is saved through the verified editor.
  const { offline, detailEditor, attachmentController, state: syncState } = useOfflineSync();
  const offlineReady = offline && Platform.OS !== "web" && !!detailEditor && syncState.records.some((row) => row.entityType === "vehicle" && row.entityId === vehicleId && row.record !== null);
  const stagedPhotos = useRef(new Map<string, string>());
  const offlineSave = useRef<ReturnType<typeof createDetailChangeActions> | null>(null);

  useEffect(() => { if (!templateLoading && !templateInitialized.current) { setItems(templateItems.map((item) => ({ id: item.id, label: item.label, kind: item.kind, ...(item.kind === "photo" ? {} : { result: "Pass" as const }) }))); templateInitialized.current = true; } }, [templateItems, templateLoading]);

  useEffect(() => () => {
    if (!saved.current) void removeFleetFiles([...uploadedPaths.current]);
  }, []);

  // Leaving with recorded results would silently discard the inspection and its photos, so confirm first.
  const unsaved = Boolean(assignmentIncident.trim()) || items.some((item) => item.result === "Fail" || item.photo || item.defectNotes);
  const allowLeave = usePreventRemove(unsaved, ({ repeat }) => {
    Alert.alert("Discard inspection?", "Results and photos entered on this inspection will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => { allowLeave(); repeat(); } },
    ]);
  });

  if (!session || access.status === "error") return <Redirect href="/" />;
  if (user && !canInspectVehicle(user.role)) return <Redirect href="/(tabs)/fleet" />;

  const updateItem = (index: number, patch: Partial<CheckItem>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const selectResult = (index: number, result: "Pass" | "Fail") => {
    const oldPhoto = items[index]?.photo as FleetVehicleFile | undefined;
    if (result === "Pass" && oldPhoto?.path) {
      uploadedPaths.current.delete(oldPhoto.path);
      void removeFleetFiles([oldPhoto.path]);
    }
    updateItem(index, result === "Pass" ? { result, defectNotes: undefined, photo: undefined } : { result });
  };
  const attachPhoto = async (index: number, source: "camera" | "library") => {
    if (!companyId || !user) return;
    setError("");
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { Alert.alert("Camera access required", "Allow camera access to attach inspection photos."); return; }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { Alert.alert("Photo access required", "Allow photo access to attach inspection photos."); return; }
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (offline) {
      if (!offlineReady || !attachmentController) { setError(offlineReady ? "Device photo storage is not available for this account. Reconnect to attach photos." : "Download this vehicle online first (saved-detail editor) to inspect it offline."); return; }
      setUploading(index);
      try {
        const attachmentId = createFleetId();
        const staged = await attachmentController.stageVehicleFile({ attachmentId, entityId: vehicleId, uri: asset.uri, name: asset.fileName ?? "inspection-photo.jpg", mimeType: asset.mimeType ?? "image/jpeg" });
        const { state: _state, error: _error, ...manifest } = staged;
        const itemId = items[index]?.id;
        if (itemId) stagedPhotos.current.set(itemId, attachmentId);
        updateItem(index, { photo: vehicleSlotFileValue(manifest as AttachmentUploadManifest) });
      } catch (stageError) {
        setError(stageError instanceof Error ? stageError.message : "Photo could not be saved on this device.");
      } finally { setUploading(null); }
      return;
    }
    setUploading(index);
    try {
      const previous = items[index]?.photo as FleetVehicleFile | undefined;
      const photo = await uploadFleetFile(companyId, user.id, { uri: asset.uri, name: asset.fileName ?? "inspection-photo.jpg", type: asset.mimeType ?? "image/jpeg" });
      if (photo.path) uploadedPaths.current.add(photo.path);
      if (previous?.path) { uploadedPaths.current.delete(previous.path); await removeFleetFiles([previous.path]); }
      updateItem(index, { photo: { name: photo.name, type: photo.type ?? "image/jpeg", dataUrl: "", path: photo.path ?? undefined } });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Photo could not be attached.");
    } finally { setUploading(null); }
  };
  const choosePhoto = (index: number) => Alert.alert("Attach photo", "Choose photo source.", [
    { text: "Camera", onPress: () => void attachPhoto(index, "camera") },
    { text: "Photo library", onPress: () => void attachPhoto(index, "library") },
    { text: "Cancel", style: "cancel" },
  ]);
  const submit = async () => {
    if (!vehicle || !user || saving || uploading !== null) return;
    const missingPhoto = items.find((item) => item.kind === "photo" && !item.photo);
    if (missingPhoto) { setError(`${missingPhoto.label} photo is required.`); return; }
    if (offline) {
      if (!offlineReady || !detailEditor) { setError("Download this vehicle online first (saved-detail editor) to inspect it offline."); return; }
      if (items.some((item) => item.photo && !item.photo.path?.includes("/sync-"))) { setError("Some photos were uploaded online. Reconnect to submit, or attach them again offline."); return; }
      setSaving(true); setError("");
      try {
        const editor = detailEditor;
        offlineSave.current ??= createDetailChangeActions({ isCurrent: () => true, prepare: () => editor.prepare({ entityType: "vehicle", entityId: vehicleId }), save: (draft, values, extras) => editor.save(draft, values, extras) });
        const actions = offlineSave.current;
        // A failed editor save never committed (validation or rolled-back SQLite), so a corrected
        // resubmission starts a fresh change instead of retrying stale values.
        const done = await actions.start("inspection", (draft) => ({
          values: { inspections: [{ id: createFleetId(), assignmentIncident: assignmentIncident.trim(), inspectorId: user.id, inspectorName: user.name, createdAt: new Date().toISOString(), items } as unknown as SyncRecord, ...((draft.record.inspections as SyncRecord[] | undefined) ?? [])] },
          extras: { attachmentIds: items.flatMap((item) => item.photo ? [stagedPhotos.current.get(item.id)].filter((id): id is string => !!id) : []) },
        }));
        if (done) { saved.current = true; allowLeave(); router.back(); }
      } catch (saveError) {
        offlineSave.current?.cancel();
        setError(saveError instanceof Error ? saveError.message : "Inspection could not be saved on this device.");
      } finally { setSaving(false); }
      return;
    }
    setSaving(true); setError("");
    try {
      await saveFleetInspection(vehicle, { id: createFleetId(), assignmentIncident: assignmentIncident.trim(), inspectorId: user.id, inspectorName: user.name, createdAt: new Date().toISOString(), items }, user);
      saved.current = true;
      allowLeave();
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Inspection could not be saved.");
    } finally { setSaving(false); }
  };

  return <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
    <Stack.Screen options={{ title: "Inspect vehicle" }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}><Text style={styles.title}>{vehicle?.name ?? "Vehicle inspection"}</Text><Text style={styles.subtitle}>Complete readiness checklist. Pass selected by default.</Text>{offline ? <Text style={styles.help}>{offlineReady ? "Offline: this inspection and its photos are saved on this device and sync when connected. Photos are not encrypted by FireOps." : "Offline: download this vehicle online first (saved-detail editor) to inspect it offline."}</Text> : null}</View>
        {loading ? <Text style={styles.help}>Loading vehicle…</Text> : !vehicle ? <Text style={styles.error}>Vehicle not found.</Text> : <>
          <View style={styles.field}><Text style={styles.label}>Assignment / Incident</Text><TextInput accessibilityLabel="Assignment or incident" value={assignmentIncident} onChangeText={setAssignmentIncident} maxLength={200} placeholder="Assignment or incident name" placeholderTextColor={theme.secondary} style={styles.input}/></View>
          <View style={styles.field}><Text style={styles.label}>Inspector</Text><View style={styles.readonly}><Text style={styles.readonlyText}>{user?.name ?? "Current user"}</Text></View></View>
          <Text style={styles.sectionTitle}>Checklist</Text>
          {templateLoading ? <Text style={styles.help}>Loading inspection template…</Text> : null}
          {templateError ? <Text style={styles.error}>{templateError}</Text> : null}
          {!templateLoading && !templateError && !items.length ? <Text style={styles.help}>No checklist items yet. Ask an owner or admin to add items to the inspection template.</Text> : null}
          {items.map((item, index) => <View key={item.id} style={[styles.check, item.result === "Fail" && styles.checkFailed]}>
            <Text style={styles.checkLabel}>{item.label}</Text>
            {item.kind === "photo" ? <View style={styles.defect}><Text style={styles.requiredPhoto}>Photo required</Text><Pressable accessibilityRole="button" accessibilityLabel={item.photo ? `Replace ${item.label} photo` : `Upload ${item.label} photo`} disabled={uploading !== null} onPress={() => choosePhoto(index)} style={styles.photoButton}><Text style={styles.photoText}>{uploading === index ? "Uploading…" : item.photo ? `Photo: ${item.photo.name}` : "Upload photo"}</Text></Pressable></View> : <>
              <View style={styles.options}><Pressable accessibilityRole="radio" accessibilityLabel={`${item.label}: Pass`} accessibilityState={{ checked: item.result === "Pass" }} onPress={() => selectResult(index, "Pass")} style={[styles.option, item.result === "Pass" && styles.passSelected]}><Text style={[styles.optionText, item.result === "Pass" && styles.passText]}>Pass</Text></Pressable><Pressable accessibilityRole="radio" accessibilityLabel={`${item.label}: Fail`} accessibilityState={{ checked: item.result === "Fail" }} onPress={() => selectResult(index, "Fail")} style={[styles.option, item.result === "Fail" && styles.failSelected]}><Text style={[styles.optionText, item.result === "Fail" && styles.failText]}>Fail</Text></Pressable></View>
              {item.result === "Fail" ? <View style={styles.defect}><Text style={styles.label}>Defect Notes</Text><TextInput accessibilityLabel={`${item.label} defect notes`} value={item.defectNotes ?? ""} onChangeText={(value) => updateItem(index, { defectNotes: value })} maxLength={2000} multiline textAlignVertical="top" placeholder="Describe defect" placeholderTextColor={theme.secondary} style={[styles.input, styles.notes]}/><Pressable accessibilityRole="button" accessibilityLabel={item.photo ? `Replace ${item.label} defect photo` : `Attach ${item.label} defect photo`} disabled={uploading !== null} onPress={() => choosePhoto(index)} style={styles.photoButton}><Text style={styles.photoText}>{uploading === index ? "Uploading…" : item.photo ? `Photo: ${item.photo.name}` : "Attach photo"}</Text></Pressable></View> : null}
            </>}
          </View>)}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={saving || uploading !== null || templateLoading || Boolean(templateError) || !items.length} onPress={() => void submit()} style={[styles.submit, (saving || uploading !== null || templateLoading || Boolean(templateError) || !items.length) && styles.disabled]}><Text style={styles.submitText}>{saving ? "Saving…" : "Save inspection"}</Text></Pressable>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) { return StyleSheet.create({
  flex:{flex:1},safeArea:{flex:1,backgroundColor:theme.canvas},content:{paddingHorizontal:20,paddingTop:24,paddingBottom:48,gap:20},heading:{gap:6},title:{color:theme.ink,fontSize:28,lineHeight:34,fontWeight:"800"},subtitle:{color:theme.secondary,fontSize:14,lineHeight:21},help:{color:theme.secondary},field:{gap:8},label:{color:theme.ink,fontSize:14,fontWeight:"700"},input:{minHeight:48,borderWidth:1,borderColor:theme.divider,borderRadius:11,backgroundColor:theme.paper,color:theme.ink,paddingHorizontal:13,fontSize:16},readonly:{minHeight:48,justifyContent:"center",borderWidth:1,borderColor:theme.divider,borderRadius:11,backgroundColor:theme.surfaceAlt,paddingHorizontal:13},readonlyText:{color:theme.ink,fontSize:16,fontWeight:"600"},sectionTitle:{color:theme.ink,fontSize:18,fontWeight:"800",marginTop:4},check:{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:13,backgroundColor:theme.paper,padding:14},checkFailed:{borderColor:theme.danger,backgroundColor:theme.dangerSurface},checkLabel:{color:theme.ink,fontSize:15,lineHeight:21,fontWeight:"700"},options:{flexDirection:"row",gap:8},option:{flex:1,minHeight:44,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:theme.divider,borderRadius:9,backgroundColor:theme.paper},optionText:{color:theme.secondary,fontSize:13,fontWeight:"800"},passSelected:{borderColor:theme.green,backgroundColor:theme.greenSurface},passText:{color:theme.green},failSelected:{borderColor:theme.danger,backgroundColor:theme.dangerSurface},failText:{color:theme.danger},defect:{gap:9,paddingTop:3},notes:{minHeight:96,paddingTop:12,paddingBottom:12},photoButton:{minHeight:44,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:theme.ember,borderRadius:10,backgroundColor:theme.paper,paddingHorizontal:12},photoText:{color:theme.ember,fontSize:13,fontWeight:"700"},requiredPhoto:{color:theme.secondary,fontSize:12,fontWeight:"700"},error:{color:theme.danger,backgroundColor:theme.dangerSurface,borderRadius:10,padding:13,fontSize:14,lineHeight:20},submit:{minHeight:52,alignItems:"center",justifyContent:"center",borderRadius:12,backgroundColor:theme.ember},submitText:{color:"#FFFFFF",fontSize:16,fontWeight:"800"},disabled:{opacity:.5},
}); }
