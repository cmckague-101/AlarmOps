import { useEffect, useMemo, useState } from "react";
import { inspectionExpirationDate, canInspectVehicle, canOpenVehicleIssue, type NifcIncident, type VehicleStatus } from "@fireops/domain";
import * as ImagePicker from "expo-image-picker";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppSymbol } from "@/components/app-symbol";
import { openFleetFile, removeFleetFiles, uploadFleetFile } from "@/lib/fleet-files";
import {
  deleteFleetVehicle,
  refreshFleet,
  updateFleetVehicle,
  updateFleetVehicleFiles,
  useFleetVehicles,
  type FleetVehicleFile,
} from "@/lib/fleet-store";
import { fetchNifcIncidents } from "@/lib/nifc";
import { saveFireList } from "@/lib/offline-fire-list";
import { useFleetFileUrl } from "@/lib/use-fleet-file-url";
import { useSession } from "@/providers/session-provider";
import { useOfflineSync } from "@/providers/offline-sync-provider";
import {savedDetailHref} from '@/lib/offline-detail-form';
import { FireOpsTheme, useFireOpsTheme } from "@/theme";

function displayStatus(status: string) {
  const value = status.trim().replaceAll("_", " ").replaceAll("-", " ").toLowerCase();
  if (value === "out of service") return "Out of Service";
  return value
    .split(" ")
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : "")
    .join(" ");
}

function statusTone(status: string): "ready" | "attention" | "assigned" {
  const value = status.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  if (["ready", "available", "in service", "active"].includes(value))
    return "ready";
  if (
    ["maintenance", "inspection", "out of service", "offline"].includes(value)
  )
    return "attention";
  return "assigned";
}

function formattedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function telemetryIsCurrent(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Date.now() - timestamp < 15 * 60 * 1000;
}

function formatSpeed(value: string) {
  const speed = Number(value);
  return Number.isFinite(speed) ? `${Math.round(speed)} mph` : value || "Unavailable";
}

function VehicleLocationMap({ latitude, longitude, location, onOpen, styles, theme }: {
  latitude: number;
  longitude: number;
  location: string;
  onOpen: () => void;
  styles: DetailStyles;
  theme: FireOpsTheme;
}) {
  const [width, setWidth] = useState(0);
  const zoom = 15;
  const tileSize = 256;
  const tileCount = 2 ** zoom;
  const safeLatitude = Math.max(-85.0511, Math.min(85.0511, latitude));
  const x = (longitude + 180) / 360 * tileCount;
  const latitudeRadians = safeLatitude * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2 * tileCount;
  const centerX = Math.floor(x);
  const centerY = Math.floor(y);
  const tiles = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const tileX = (centerX + column + tileCount) % tileCount;
      const tileY = Math.max(0, Math.min(tileCount - 1, centerY + row));
      tiles.push(
        <Image
          accessibilityIgnoresInvertColors
          key={`${tileX}-${tileY}`}
          source={{ uri: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png` }}
          style={{ position: "absolute", left: (column + 1) * tileSize, top: (row + 1) * tileSize, width: tileSize, height: tileSize }}
        />,
      );
    }
  }
  return (
    <Pressable
      accessibilityHint="Opens vehicle location on Operations map"
      accessibilityLabel={`View ${location} on Operations map`}
      accessibilityRole="button"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={onOpen}
      style={({ pressed }) => [styles.locationMap, pressed && styles.buttonPressed]}
    >
      <View style={[styles.locationTiles, { left: width / 2 - (x - (centerX - 1)) * tileSize, top: 105 - (y - (centerY - 1)) * tileSize }]}>{tiles}</View>
      <View style={styles.locationMarker}>
        <AppSymbol name={{ ios: "truck.box.fill", android: "local_shipping" } as never} color="#FFFFFF" size={16} />
      </View>
      <View style={styles.locationCaption}>
        <View style={styles.locationCaptionText}>
          <AppSymbol name={{ ios: "location.fill", android: "location_on" } as never} color={theme.ember} size={13} />
          <Text numberOfLines={1} style={styles.locationCaptionLabel}>{location}</Text>
        </View>
        <Text style={styles.locationAttribution}>© OpenStreetMap contributors</Text>
      </View>
    </Pressable>
  );
}

function DetailRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string | null;
  styles: DetailStyles;
}) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable>
        {value}
      </Text>
    </View>
  );
}

type DetailStyles = ReturnType<typeof createStyles>;
const vehicleStatuses: VehicleStatus[] = ["Ready", "Out of service"];
const binderDocuments = ["Contract", "VIPR Checklist", "Registration", "Insurance", "DOT Inspection"];

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access,demoMode } = useSession();
  const {offline,state:syncState}=useOfflineSync();
  const companyId =
    access.value?.kind === "member" ? access.value.company.id : null;
  const user = access.value?.kind === "member" ? access.value.user : null;
  const { vehicles, issues, crew, loading, error,pendingDetails } =
    useFleetVehicles(companyId);
  const vehicle = vehicles.find((item) => item.id === id);
  const photoUrl = useFleetFileUrl(vehicle?.photo);
  const assignedName = crew.find(
    (member) => member.id === vehicle?.assignedTo,
  )?.name;
  const openIssues = issues.filter(
    (issue) => issue.vehicleId === id && issue.status === "Open",
  );
  const resolvedIssues = issues
    .filter((issue) => (user?.role === "owner" || user?.role === "admin") && issue.vehicleId === id && issue.status === "Resolved")
    .sort(
      (a, b) =>
        Date.parse(b.resolvedAt ?? b.createdAt) -
        Date.parse(a.resolvedAt ?? a.createdAt),
    );
  const activeCrew = crew.filter((member) => member.status === "Active");
  const canManage = user?.role === "owner" || user?.role === "admin";
  const savedDetailBase=syncState.records.find(record=>record.entityType==='vehicle'&&record.entityId===id&&record.record!==null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);
  const [crewQuery, setCrewQuery] = useState("");
  const [fileError, setFileError] = useState("");
  const [photoSaving, setPhotoSaving] = useState(false);
  const [firePickerOpen, setFirePickerOpen] = useState(false);
  const [fireQuery, setFireQuery] = useState("");
  const [incidents, setIncidents] = useState<NifcIncident[]>([]);
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [incidentError, setIncidentError] = useState("");
  const [incidentRequest, setIncidentRequest] = useState(0);
  const visibleCrew = activeCrew.filter((member) =>
    member.name.toLowerCase().includes(crewQuery.trim().toLowerCase()),
  );
  const normalizedFireQuery = fireQuery.trim().toLowerCase();
  const visibleIncidents = useMemo(
    () =>
      incidents
        .filter((incident) =>
          `${incident.name} ${incident.state}`
            .toLowerCase()
            .includes(normalizedFireQuery),
        )
        .slice(0, 50),
    [incidents, normalizedFireQuery],
  );

  useEffect(() => {
    if (!firePickerOpen) return;
    const controller = new AbortController();
    void fetchNifcIncidents(controller.signal)
      .then((next) => { saveFireList(next); setIncidents(next); }) // kept for assigning fires offline
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError")
          return;
        setIncidentError(
          "Active fires could not be loaded. Check your connection and retry.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIncidentLoading(false);
      });
    return () => controller.abort();
  }, [firePickerOpen, incidentRequest]);

  if (!session || access.status === "error") return <Redirect href="/" />;

  const changePhoto = async () => {
    if (!vehicle || !user || !companyId || !canManage || photoSaving) return;
    setFileError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) return;
      setPhotoSaving(true);
      const asset = result.assets[0];
      const uploaded = await uploadFleetFile(companyId, user.id, {
        uri: asset.uri,
        name: asset.fileName ?? `${vehicle.name}-photo.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
      try {
        await updateFleetVehicleFiles(
          vehicle,
          { photo: uploaded },
          user,
          { action: `${vehicle.name} photo updated`, detail: "Vehicle photo changed" },
        );
      } catch (error) {
        void removeFleetFiles([uploaded.path]).catch(() => undefined);
        throw error;
      }
      if (vehicle.photo?.path)
        void removeFleetFiles([vehicle.photo.path]).catch(() => undefined);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Photo could not be updated.");
    } finally {
      setPhotoSaving(false);
    }
  };

  const changeStatus = async (status: VehicleStatus) => {
    if (!vehicle || !user || !canManage || vehicle.status === status) return;
    setSaving(true);
    setSaveError("");
    try {
      await updateFleetVehicle(
        vehicle,
        { status, clearAssignment: true },
        user,
        {
          action: `${vehicle.name} status changed to ${status}`,
          detail: `Previous status: ${vehicle.status}`,
          tone: status === "Out of service" ? "urgent" : "complete",
        },
      );
    } catch (mutationError) {
      setSaveError(
        mutationError instanceof Error
          ? mutationError.message
          : "Status could not be changed.",
      );
    } finally {
      setSaving(false);
    }
  };

  const openAttachment = async (file: FleetVehicleFile) => {
    setFileError("");
    try {
      const url = await openFleetFile(file);
      await Linking.openURL(url);
    } catch (openError) {
      setFileError(
        openError instanceof Error
          ? openError.message
          : "Attachment could not be opened.",
      );
    }
  };

  const confirmDeleteVehicle = () => {
    if (!vehicle || !user || !canManage || deleting) return;
    const linkedIssues = issues.filter((issue) => issue.vehicleId === vehicle.id);
    Alert.alert(
      `Delete ${vehicle.name}?`,
      `This permanently deletes the vehicle record${
        linkedIssues.length
          ? ` and ${linkedIssues.length} linked ${linkedIssues.length === 1 ? "issue" : "issues"}`
          : ""
      }. This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete vehicle",
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            setDeleteError("");
            const filePaths = [
              vehicle.photo?.path,
              ...vehicle.files.map(({ file }) => file.path),
            ];
            void deleteFleetVehicle(vehicle, linkedIssues, user)
              .then(async () => {
                let cleanupFailed = false;
                try {
                  await removeFleetFiles(filePaths);
                } catch {
                  cleanupFailed = true;
                }
                router.back();
                if (cleanupFailed) {
                  Alert.alert(
                    "Vehicle deleted",
                    "Vehicle record was deleted, but some stored uploads could not be cleaned up.",
                  );
                }
              })
              .catch((deleteFailure) => {
                setDeleteError(
                  deleteFailure instanceof Error
                    ? deleteFailure.message
                    : "Vehicle could not be deleted.",
                );
              })
              .finally(() => setDeleting(false));
          },
        },
      ],
    );
  };

  const changeFireAssignment = async (incident?: NifcIncident) => {
    if (
      !vehicle ||
      !user ||
      saving ||
      !vehicle.assignedTo ||
      (!canManage && vehicle.assignedTo !== user.id)
    ) return;
    if (incident?.id === vehicle.assignedFire?.id) {
      setFirePickerOpen(false);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await updateFleetVehicle(
        vehicle,
        incident
          ? {
              status: "Assigned",
              assignedFire: {
                id: incident.id,
                name: incident.name,
                state: incident.state,
              },
            }
          : { clearFireAssignment: true },
        user,
        {
          action: `${vehicle.name} fire assignment updated`,
          detail: incident
            ? `Assigned to ${incident.name}`
            : "Fire assignment cleared",
          tone: "complete",
        },
      );
      setFirePickerOpen(false);
      setFireQuery("");
    } catch (mutationError) {
      setSaveError(
        mutationError instanceof Error
          ? mutationError.message
          : "Fire assignment could not be changed.",
      );
    } finally {
      setSaving(false);
    }
  };

  const changeAssignment = async (memberId?: string) => {
    if (!vehicle || !user || saving) return;
    const member = activeCrew.find((item) => item.id === memberId);
    setSaving(true);
    setSaveError("");
    try {
      await updateFleetVehicle(
        vehicle,
        memberId
          ? { status: "Assigned", assignedTo: memberId }
          : {
              status:
                vehicle.status === "Assigned"
                  ? "Ready"
                  : (vehicle.status as VehicleStatus),
              clearAssignment: true,
            },
        user,
        {
          action:
            memberId === user.id
              ? `${user.name} assigned ${vehicle.name} to themselves`
              : memberId
                ? `${vehicle.name} assignment updated`
                : `${user.name} unassigned ${vehicle.name}`,
          detail: member
            ? `Assigned to ${member.name}`
            : "Vehicle returned to ready status",
          tone: "complete",
        },
      );
    } catch (mutationError) {
      setSaveError(
        mutationError instanceof Error
          ? mutationError.message
          : "Assignment could not be changed.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: vehicle?.name ?? "Vehicle",
          headerRight:
            canManage && vehicle
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${vehicle.name}`}
                    onPress={() =>
                      router.push(offline&&Platform.OS!=='web'&&!demoMode?savedDetailHref({entityType:'vehicle',entityId:vehicle.id}):{
                        pathname: "/vehicle/form",
                        params: { id: vehicle.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.headerEdit,
                      pressed && styles.headerEditPressed,
                    ]}
                  >
                    <AppSymbol name="pencil" color={theme.ember} size={17} />
                    <Text style={styles.headerEditLabel}>Edit</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <Text style={styles.stateText}>Loading vehicle…</Text>
        ) : null}

        {!loading && (error || !vehicle) ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>
              {error ? "Vehicle unavailable" : "Vehicle not found"}
            </Text>
            <Text style={styles.messageText}>
              {error ??
                "This vehicle may have been removed or you may no longer have access."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void refreshFleet()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.retryButtonPressed,
              ]}
            >
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {vehicle ? (
          <>
            {pendingDetails?.[`vehicle:${vehicle.id}`]?<Text accessibilityRole="alert" style={styles.stateText}>{pendingDetails[`vehicle:${vehicle.id}`]}</Text>:null}
            {(canManage||user?.role==='fire_fighter'||user?.role==='shop_tech')&&Platform.OS!=='web'&&!demoMode?<View>
              <Pressable accessibilityRole="button" onPress={()=>router.push(savedDetailHref({entityType:'vehicle',entityId:vehicle.id}))} style={styles.retryButton}><Text style={styles.retryLabel}>{canManage?(savedDetailBase?'Edit downloaded details':'Download / edit saved details'):(savedDetailBase?'Claim / release offline':'Download for offline claim / release')}</Text></Pressable>
              {canManage?<Pressable accessibilityRole="button" onPress={()=>router.push({pathname:'/sync-conflict',params:{entityType:'vehicle',entityId:vehicle.id}} as never)} style={styles.retryButton}><Text style={styles.retryLabel}>Inspect device edit history (online)</Text></Pressable>:null}
              <Text style={styles.stateText}>{savedDetailBase?(canManage?'Verified details downloaded. Details, status/assignment and vehicle files can be saved offline in this editor.':'Verified vehicle downloaded. You can claim, release or clear its fire offline.'):'Open the saved-detail editor online once to download a verified base for offline changes.'} Inspections and fire assignment stay online-only.</Text>
            </View>:null}
            <View style={styles.identity}>
              {photoUrl ? (
                <Pressable
                  accessibilityRole={canManage ? "button" : "image"}
                  accessibilityLabel={canManage ? `Change ${vehicle.name} vehicle photo` : `${vehicle.name} vehicle photo`}
                  disabled={!canManage || photoSaving}
                  onPress={() => void changePhoto()}
                  style={({ pressed }) => [styles.vehiclePhotoButton, pressed && styles.buttonPressed]}
                >
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="cover"
                    source={{ uri: photoUrl }}
                    style={styles.vehiclePhoto}
                  />
                  {canManage ? (
                    <View style={styles.photoEditBadge}>
                      <AppSymbol name={{ ios: "camera.fill", android: "photo_camera" } as never} color="#FFFFFF" size={13} />
                      <Text style={styles.photoEditLabel}>{photoSaving ? "Saving…" : "Change photo"}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : canManage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${vehicle.name} vehicle photo`}
                  disabled={photoSaving}
                  onPress={() => void changePhoto()}
                  style={({ pressed }) => [styles.emptyVehiclePhoto, pressed && styles.buttonPressed]}
                >
                  <AppSymbol name={{ ios: "camera.fill", android: "photo_camera" } as never} color={theme.ember} size={24} />
                  <Text style={styles.emptyVehiclePhotoLabel}>{photoSaving ? "Saving…" : "Add vehicle photo"}</Text>
                </Pressable>
              ) : null}
              {fileError ? <Text accessibilityRole="alert" style={styles.saveError}>{fileError}</Text> : null}
              <View style={styles.titleRow}>
                <Text style={styles.title}>{vehicle.name}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    styles[`${statusTone(vehicle.status)}Badge`],
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      styles[`${statusTone(vehicle.status)}Text`],
                    ]}
                  >
                    {displayStatus(vehicle.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.vehicleSummary}>
                {[vehicle.type, vehicle.detail].filter(Boolean).join(" · ")}
              </Text>
              {vehicle.assignedTo ? (
                <Text style={styles.assignment}>
                  Assigned to {assignedName ?? "Crew member"}
                </Text>
              ) : null}
              {vehicle.assignedFire ? (
                <Text style={styles.fireAssignment}>
                  Fire: {vehicle.assignedFire.name}
                  {vehicle.assignedFire.state
                    ? ` · ${vehicle.assignedFire.state}`
                    : ""}
                </Text>
              ) : null}
              <View style={styles.topActions}>
                {user && canInspectVehicle(user.role) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: "/inspection/new" as never, params: { vehicleId: vehicle.id } })}
                    style={({ pressed }) => [styles.inspectButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.inspectLabel}>Inspect</Text>
                  </Pressable>
                ) : null}
                {user && canOpenVehicleIssue(user.role) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/issue/new" as never,
                        params: { vehicleId: vehicle.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.openIssueButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.openIssueLabel}>Open issue</Text>
                  </Pressable>
                ) : null}
                {user?.role !== "fire_fighter" ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/vehicle-notes/${encodeURIComponent(vehicle.id)}` as never)}
                    style={({ pressed }) => [styles.vehicleNotesButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.vehicleNotesLabel}>Vehicle Notes</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {vehicle.motive ? (
              <View style={styles.motiveStack}>
                <View accessibilityLabel="Motive vehicle status" style={styles.motiveCard}>
                <View style={styles.motiveHeading}>
                  <View style={styles.motiveLive}>
                    <View style={[styles.connectionDot, telemetryIsCurrent(vehicle.motive.updatedAt) && styles.connectionDotLive]} />
                    <Text style={styles.motiveTitle}>Motive {telemetryIsCurrent(vehicle.motive.updatedAt) ? "live" : "last known"}</Text>
                  </View>
                  <Text style={styles.motiveUpdated}>Updated {formattedDate(vehicle.motive.updatedAt) ?? vehicle.motive.updatedAt}</Text>
                </View>
                <View style={styles.motiveReading}>
                  <AppSymbol name={{ ios: "location.fill", android: "location_on" } as never} color={theme.ember} size={18} />
                  <View style={styles.motiveReadingCopy}>
                    <Text style={styles.motiveLabel}>Location</Text>
                    <Text style={styles.motiveValue}>{vehicle.motive.location || "Unavailable"}</Text>
                  </View>
                </View>
                <View style={styles.motiveReading}>
                  <AppSymbol name={{ ios: "gauge.with.dots.needle.67percent", android: "speed" } as never} color={theme.ember} size={18} />
                  <View style={styles.motiveReadingCopy}>
                    <Text style={styles.motiveLabel}>Speed</Text>
                    <Text style={styles.motiveValue}>{formatSpeed(vehicle.motive.speed)}</Text>
                  </View>
                </View>
                {vehicle.motive.diagnostics !== undefined ? (
                  <View accessibilityLabel={vehicle.motive.diagnostics.length ? `${vehicle.motive.diagnostics.length} open diagnostic codes` : "No open diagnostic codes"} style={styles.diagnostics}>
                    <View style={styles.diagnosticsHeading}>
                      <AppSymbol name={vehicle.motive.diagnostics.length ? ({ ios: "exclamationmark.triangle.fill", android: "warning" } as never) : ({ ios: "checkmark.circle.fill", android: "check_circle" } as never)} color={vehicle.motive.diagnostics.length ? "#FFB4AB" : "#52D394"} size={17} />
                      <Text style={[styles.diagnosticsTitle, !vehicle.motive.diagnostics.length && styles.diagnosticsClear]}>{vehicle.motive.diagnostics.length ? "Open diagnostic codes" : "No open diagnostic codes"}</Text>
                      {vehicle.motive.diagnostics.length ? <Text style={styles.diagnosticsCount}>{vehicle.motive.diagnostics.length}</Text> : null}
                    </View>
                    {vehicle.motive.diagnostics.map(code => (
                      <View key={code.id} style={styles.diagnosticRow}>
                        <Text style={styles.diagnosticCode}>{code.label}</Text>
                        <Text style={styles.diagnosticDescription}>{code.description || "Description unavailable"}</Text>
                        <Text style={styles.diagnosticDate}>Last observed {formattedDate(code.lastObservedAt ?? null) ?? "unknown"}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                </View>
                {typeof vehicle.motive.latitude === "number" && Number.isFinite(vehicle.motive.latitude) && typeof vehicle.motive.longitude === "number" && Number.isFinite(vehicle.motive.longitude) ? (
                  <VehicleLocationMap latitude={vehicle.motive.latitude} longitude={vehicle.motive.longitude} location={vehicle.motive.location || "Vehicle location"} onOpen={() => router.push({ pathname: "/(tabs)/operations", params: { vehicleId: vehicle.id } })} styles={styles} theme={theme} />
                ) : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Current status</Text>
              {canManage ? (
                <View style={styles.choiceList}>
                  {vehicleStatuses.map((status) => {
                    const selected = vehicle.status === status;
                    const disabled = saving;
                    return (
                      <Pressable
                        key={status}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled }}
                        disabled={disabled}
                        onPress={() => void changeStatus(status)}
                        style={({ pressed }) => [
                          styles.choice,
                          selected && styles.choiceSelected,
                          disabled && styles.disabled,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceLabel,
                            selected && styles.choiceLabelSelected,
                          ]}
                        >
                          {displayStatus(status)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.readOnlyStatus}>
                  Status changes are managed by company owner.
                </Text>
              )}

              {canManage ? (
                <>
                  <Text style={styles.controlLabel}>Assigned crew member</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Assigned crew member"
                    accessibilityState={{
                      expanded: crewPickerOpen,
                      disabled: saving,
                    }}
                    disabled={saving}
                    onPress={() => setCrewPickerOpen(true)}
                    style={({ pressed }) => [
                      styles.crewDropdown,
                      saving && styles.disabled,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.crewDropdownText,
                        !assignedName && styles.crewDropdownPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {assignedName ?? "No crew member assigned"}
                    </Text>
                    <AppSymbol
                      name={
                        {
                          ios: "chevron.down",
                          android: "arrow_drop_down",
                        } as never
                      }
                      color={theme.secondary}
                      size={18}
                    />
                  </Pressable>
                </>
              ) : user ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    saving ||
                    Boolean(
                      vehicle.assignedTo && vehicle.assignedTo !== user.id,
                    ) ||
                    (!vehicle.assignedTo && vehicle.status !== "Ready")
                  }
                  onPress={() =>
                    void changeAssignment(
                      vehicle.assignedTo === user.id ? undefined : user.id,
                    )
                  }
                  style={({ pressed }) => [
                    styles.assignmentButton,
                    (saving ||
                      Boolean(
                        vehicle.assignedTo && vehicle.assignedTo !== user.id,
                      ) ||
                      (!vehicle.assignedTo && vehicle.status !== "Ready")) &&
                      styles.disabled,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.assignmentButtonLabel}>
                    {saving
                      ? "Saving…"
                      : vehicle.assignedTo === user.id
                        ? "Remove my assignment"
                        : vehicle.assignedTo
                          ? "Assigned to another member"
                          : vehicle.status !== "Ready"
                            ? "Vehicle unavailable"
                            : "Assign to me"}
                  </Text>
                </Pressable>
              ) : null}
              {saveError ? (
                <Text accessibilityRole="alert" style={styles.saveError}>
                  {saveError}
                </Text>
              ) : null}
            </View>

            {user && (canManage || vehicle.assignedTo === user.id) ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Fire assignment</Text>
                {vehicle.assignedTo ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Assigned NIFC fire"
                      accessibilityState={{
                        expanded: firePickerOpen,
                        disabled: saving,
                      }}
                      disabled={saving}
                      onPress={() => {
                        setIncidentLoading(true);
                        setIncidentError("");
                        setFirePickerOpen(true);
                      }}
                      style={({ pressed }) => [
                        styles.fireDropdown,
                        saving && styles.disabled,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View style={styles.fireDropdownCopy}>
                        <Text
                          style={[
                            styles.fireDropdownText,
                            !vehicle.assignedFire &&
                              styles.crewDropdownPlaceholder,
                          ]}
                          numberOfLines={1}
                        >
                          {vehicle.assignedFire?.name ?? "Search active fires"}
                        </Text>
                        {vehicle.assignedFire?.state ? (
                          <Text style={styles.fireDropdownMeta}>
                            {vehicle.assignedFire.state} · NIFC WFIGS
                          </Text>
                        ) : null}
                      </View>
                      <AppSymbol
                        name={{ ios: "chevron.down", android: "arrow_drop_down" } as never}
                        color={theme.secondary}
                        size={18}
                      />
                    </Pressable>
                    {vehicle.assignedFire ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Clear fire assignment to ${vehicle.assignedFire.name}`}
                        disabled={saving}
                        onPress={() => void changeFireAssignment()}
                        style={({ pressed }) => [
                          styles.clearFireButton,
                          saving && styles.disabled,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.clearFireLabel}>
                          {saving ? "Saving…" : "Clear fire assignment"}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.fireHelp}>
                        Search active NIFC incidents and assign this vehicle.
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.readOnlyStatus}>
                    Assign crew member before selecting fire.
                  </Text>
                )}
              </View>
            ) : null}

            {openIssues.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Open issues · {openIssues.length}
                </Text>
                <View style={styles.issueList}>
                  {openIssues.map((issue) => (
                    <Pressable
                      key={issue.id}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push(
                          `/issue/${encodeURIComponent(issue.id)}` as never,
                        )
                      }
                      style={({ pressed }) => [
                        styles.detailIssueRow,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View style={styles.detailIssueMain}>
                        <Text style={styles.detailIssueTitle}>
                          {issue.title}
                        </Text>
                        <Text style={styles.detailIssueMeta}>
                          {issue.priority} priority · {issue.updates.length}{" "}
                          {issue.updates.length === 1 ? "update" : "updates"}
                        </Text>
                      </View>
                      <AppSymbol
                        name={
                          {
                            ios: "chevron.right",
                            android: "chevron_right",
                          } as never
                        }
                        color={theme.secondary}
                        size={17}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Digital Equipment Binder</Text>
              <View style={styles.documents}>
                {binderDocuments.map((label) => {
                  const inspectionDate = label === 'DOT Inspection' ? vehicle.documents.find(document => document.id === 'dotInspection' || document.name.toLowerCase() === 'dot inspection')?.inspectionDate : undefined;
                  const file = vehicle.files.find(
                    (entry) => entry.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
                  )?.file;
                  return (
                    <Pressable
                      key={label}
                      accessibilityRole="button"
                      accessibilityLabel={file ? `Open ${label}` : `${label} not attached`}
                      accessibilityState={{ disabled: !file?.path }}
                      disabled={!file?.path}
                      onPress={() => file && void openAttachment(file)}
                      style={({ pressed }) => [styles.documentRow, !file && styles.disabledDocument, pressed && styles.buttonPressed]}
                    >
                      <View style={styles.fileIcon}>
                        <AppSymbol name={{ ios: "doc.fill", android: "description" } as never} color={theme.ember} size={19} />
                      </View>
                      <View style={styles.documentMain}>
                        <Text style={styles.documentLabel}>{label}</Text>
                        <Text style={styles.documentName} numberOfLines={1}>{file?.name ?? "No document attached"}</Text>
                        {inspectionDate ? <Text style={styles.documentName}>Inspected {inspectionDate} · Expires {inspectionExpirationDate(inspectionDate) ?? '—'}</Text> : null}
                      </View>
                      {file?.path ? <AppSymbol name={{ ios: "chevron.right", android: "chevron_right" } as never} color={theme.secondary} size={17} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Vehicle information</Text>
              <View style={styles.details}>
                <DetailRow label="Unit" value={vehicle.name} styles={styles} />
                <DetailRow label="Type" value={vehicle.type} styles={styles} />
                <DetailRow label="Year" value={vehicle.year} styles={styles} />
                <DetailRow label="Make" value={vehicle.make} styles={styles} />
                <DetailRow label="Model" value={vehicle.model} styles={styles} />
                <DetailRow label="VIN" value={vehicle.vin} styles={styles} />
                <DetailRow label="Plate" value={vehicle.plate} styles={styles} />
              </View>
            </View>

            {resolvedIssues.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Resolved issues · {resolvedIssues.length}
                </Text>
                <View style={styles.issueList}>
                  {resolvedIssues.map((issue) => (
                    <Pressable
                      key={issue.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open resolved issue ${issue.title}`}
                      onPress={() =>
                        router.push(
                          `/issue/${encodeURIComponent(issue.id)}` as never,
                        )
                      }
                      style={({ pressed }) => [
                        styles.detailIssueRow,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View style={styles.resolvedIssueIcon}>
                        <AppSymbol
                          name={{ ios: "checkmark", android: "check" } as never}
                          color={theme.green}
                          size={15}
                        />
                      </View>
                      <View style={styles.detailIssueMain}>
                        <Text style={styles.detailIssueTitle}>
                          {issue.title}
                        </Text>
                        <Text style={styles.detailIssueMeta}>
                          Resolved {formattedDate(issue.resolvedAt ?? issue.createdAt)} · {issue.updates.length}{" "}
                          {issue.updates.length === 1 ? "update" : "updates"}
                        </Text>
                      </View>
                      <AppSymbol
                        name={{
                          ios: "chevron.right",
                          android: "chevron_right",
                        } as never}
                        color={theme.secondary}
                        size={17}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {vehicle.notes ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notes</Text>
                <Text style={styles.notes} selectable>
                  {vehicle.notes}
                </Text>
              </View>
            ) : null}

            {formattedDate(vehicle.updatedAt) ? (
              <Text style={styles.updated}>
                Updated {formattedDate(vehicle.updatedAt)}
              </Text>
            ) : null}

            {canManage ? (
              <View style={styles.dangerSection}>
                <Text style={styles.dangerTitle}>Delete vehicle</Text>
                <Text style={styles.dangerCopy}>
                  Permanently removes this vehicle and all linked issues.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${vehicle.name}`}
                  accessibilityHint="Shows a destructive confirmation"
                  accessibilityState={{ disabled: deleting }}
                  disabled={deleting}
                  onPress={confirmDeleteVehicle}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    deleting && styles.disabled,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <AppSymbol
                    name={{ ios: "trash", android: "delete" } as never}
                    color={theme.danger}
                    size={17}
                  />
                  <Text style={styles.deleteButtonLabel}>
                    {deleting ? "Deleting…" : "Delete vehicle"}
                  </Text>
                </Pressable>
                {deleteError ? (
                  <Text accessibilityRole="alert" style={styles.saveError}>
                    {deleteError}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!saving) {
            setFirePickerOpen(false);
            setFireQuery("");
          }
        }}
        presentationStyle="pageSheet"
        visible={firePickerOpen}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeadingCopy}>
              <Text style={styles.modalTitle}>Select active fire</Text>
              <Text style={styles.modalSubtitle}>NIFC WFIGS incidents</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close fire picker"
              disabled={saving}
              onPress={() => {
                setFirePickerOpen(false);
                setFireQuery("");
              }}
              hitSlop={10}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.fireSearch}>
            <AppSymbol
              name={{ ios: "magnifyingglass", android: "search" } as never}
              color={theme.secondary}
              size={18}
            />
            <TextInput
              accessibilityLabel="Search fires by name or state"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              editable={!saving}
              onChangeText={setFireQuery}
              placeholder="Search fire name or state"
              placeholderTextColor={theme.secondary}
              style={styles.fireSearchInput}
              value={fireQuery}
            />
          </View>
          {incidentLoading ? (
            <View style={styles.fireLoading}>
              <ActivityIndicator color={theme.ember} />
              <Text style={styles.noCrewResults}>Loading active fires…</Text>
            </View>
          ) : incidentError ? (
            <View style={styles.fireErrorBlock}>
              <Text accessibilityRole="alert" style={styles.saveError}>
                {incidentError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setIncidentLoading(true);
                  setIncidentError("");
                  setIncidentRequest((value) => value + 1);
                }}
                style={styles.retryButton}
              >
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.fireResults}
              data={visibleIncidents}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(incident) => incident.id}
              ListEmptyComponent={
                <Text style={styles.noCrewResults}>
                  No active fires match “{fireQuery.trim()}”.
                </Text>
              }
              renderItem={({ item: incident }) => {
                const selected = vehicle?.assignedFire?.id === incident.id;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: saving }}
                    disabled={saving}
                    onPress={() => void changeFireAssignment(incident)}
                    style={({ pressed }) => [
                      styles.fireOption,
                      selected && styles.crewOptionSelected,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <View style={styles.fireIcon}>
                      <AppSymbol
                        name={{ ios: "flame.fill", android: "local_fire_department" } as never}
                        color={theme.danger}
                        size={17}
                      />
                    </View>
                    <View style={styles.crewOptionCopy}>
                      <Text style={styles.crewOptionName}>{incident.name}</Text>
                      <Text style={styles.crewOptionMeta}>
                        {incident.state || "State not reported"}
                        {incident.acres === null
                          ? " · Acres unavailable"
                          : ` · ${Math.round(incident.acres).toLocaleString()} acres`}
                      </Text>
                    </View>
                    {selected ? (
                      <Text style={styles.crewOptionCheck}>Selected</Text>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
          {saveError ? (
            <Text accessibilityRole="alert" style={styles.modalSaveError}>
              {saveError}
            </Text>
          ) : null}
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setCrewPickerOpen(false)}
        presentationStyle="pageSheet"
        visible={crewPickerOpen}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Select crew member</Text>
              <Text style={styles.modalSubtitle}>
                {activeCrew.length} active
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCrewPickerOpen(false)}
              hitSlop={10}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="Search crew"
            autoCapitalize="words"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setCrewQuery}
            placeholder="Search crew"
            placeholderTextColor={theme.secondary}
            style={styles.crewSearch}
            value={crewQuery}
          />
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: !vehicle?.assignedTo }}
            onPress={() => {
              setCrewPickerOpen(false);
              setCrewQuery("");
              void changeAssignment();
            }}
            style={({ pressed }) => [
              styles.crewOption,
              !vehicle?.assignedTo && styles.crewOptionSelected,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.crewOptionName}>No crew member assigned</Text>
            {!vehicle?.assignedTo ? (
              <Text style={styles.crewOptionCheck}>Selected</Text>
            ) : null}
          </Pressable>
          <FlatList
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.crewResults}
            data={visibleCrew}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(member) => member.id}
            ListEmptyComponent={
              <Text style={styles.noCrewResults}>
                No active crew match this search.
              </Text>
            }
            renderItem={({ item }) => {
              const selected = vehicle?.assignedTo === item.id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    setCrewPickerOpen(false);
                    setCrewQuery("");
                    void changeAssignment(item.id);
                  }}
                  style={({ pressed }) => [
                    styles.crewOption,
                    selected && styles.crewOptionSelected,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <View style={styles.crewOptionCopy}>
                    <Text style={styles.crewOptionName}>{item.name}</Text>
                    <Text style={styles.crewOptionMeta} numberOfLines={1}>
                      {item.email}
                    </Text>
                  </View>
                  {selected ? (
                    <Text style={styles.crewOptionCheck}>Selected</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    headerEdit: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 8,
    },
    headerEditPressed: { opacity: 0.55 },
    headerEditLabel: { color: theme.ember, fontSize: 16, fontWeight: "700" },
    content: {
      flexGrow: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 40,
      gap: 30,
    },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 32 },
    identity: { gap: 8 },
    vehiclePhotoButton: {
      position: "relative",
      width: 180,
      height: 180,
      alignSelf: "center",
      borderRadius: 18,
      overflow: "hidden",
      backgroundColor: theme.surfaceAlt,
      marginBottom: 8,
    },
    vehiclePhoto: { width: "100%", height: "100%" },
    photoEditBadge: {
      position: "absolute",
      right: 8,
      bottom: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: 8,
      backgroundColor: "rgba(20, 30, 25, 0.84)",
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    photoEditLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
    emptyVehiclePhoto: {
      width: 180,
      height: 180,
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.divider,
      borderRadius: 18,
      backgroundColor: theme.surfaceAlt,
      marginBottom: 8,
    },
    emptyVehiclePhotoLabel: { color: theme.ember, fontSize: 13, fontWeight: "700" },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 16,
    },
    title: {
      flex: 1,
      color: theme.ink,
      fontSize: 30,
      lineHeight: 36,
      fontWeight: "800",
      letterSpacing: -0.7,
    },
    statusBadge: {
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    statusText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
    readyBadge: { backgroundColor: theme.greenSurface },
    readyText: { color: theme.green },
    assignedBadge: { backgroundColor: theme.warningSurface },
    assignedText: { color: theme.warning },
    attentionBadge: { backgroundColor: theme.dangerSurface },
    attentionText: { color: theme.danger },
    vehicleSummary: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    assignment: {
      color: theme.ink,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    fireAssignment: {
      color: theme.danger,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
    },
    topActions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 8 },
    inspectButton: {
      minHeight: 44,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.green,
      backgroundColor: theme.greenSurface,
      borderRadius: 10,
      paddingHorizontal: 16,
    },
    inspectLabel: { color: theme.green, fontSize: 14, fontWeight: "700" },
    openIssueButton: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      backgroundColor: theme.danger,
      borderRadius: 10,
      paddingHorizontal: 16,
    },
    openIssueLabel: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "700",
    },
    vehicleNotesButton: {
      minHeight: 44,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.ember,
      backgroundColor: theme.paper,
      borderRadius: 10,
      paddingHorizontal: 16,
    },
    vehicleNotesLabel: { color: theme.ember, fontSize: 14, fontWeight: "700" },
    buttonPressed: { opacity: 0.76 },
    motiveStack: { gap: 10 },
    motiveCard: {
      gap: 14,
      borderRadius: 14,
      backgroundColor: theme.command,
      padding: 16,
    },
    motiveHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    motiveLive: { flexDirection: "row", alignItems: "center", gap: 7 },
    connectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.secondary },
    connectionDotLive: { backgroundColor: "#52D394" },
    motiveTitle: { color: theme.commandText, fontSize: 15, fontWeight: "800" },
    motiveUpdated: { flex: 1, color: "#BFC9C2", fontSize: 11, textAlign: "right" },
    motiveReading: { flexDirection: "row", alignItems: "center", gap: 11 },
    motiveReadingCopy: { flex: 1, gap: 2 },
    motiveLabel: { color: "#BFC9C2", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    motiveValue: { color: theme.commandText, fontSize: 15, lineHeight: 21, fontWeight: "700" },
    diagnostics: { gap: 8, borderTopWidth: 1, borderTopColor: "#526158", paddingTop: 12 },
    diagnosticsHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
    diagnosticsTitle: { flex: 1, color: "#FFB4AB", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
    diagnosticsClear: { color: "#52D394" },
    diagnosticsCount: { minWidth: 24, borderRadius: 12, backgroundColor: "#5B302E", color: "#FFB4AB", paddingHorizontal: 7, paddingVertical: 2, textAlign: "center", fontSize: 11, fontWeight: "800" },
    diagnosticRow: { gap: 2, borderRadius: 8, backgroundColor: "#29372F", padding: 10 },
    diagnosticCode: { color: "#FFB4AB", fontSize: 13, fontWeight: "800" },
    diagnosticDescription: { color: theme.commandText, fontSize: 12, lineHeight: 17 },
    diagnosticDate: { color: "#BFC9C2", fontSize: 10 },
    locationMap: {
      height: 210,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 14,
      backgroundColor: theme.surfaceAlt,
    },
    locationTiles: { position: "absolute", width: 768, height: 768 },
    locationMarker: {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: 36,
      height: 36,
      marginLeft: -18,
      marginTop: -25,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: "#FFFFFF",
      borderRadius: 18,
      backgroundColor: theme.green,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    locationCaption: {
      position: "absolute",
      left: 8,
      right: 8,
      bottom: 8,
      minHeight: 34,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      borderRadius: 8,
      backgroundColor: theme.paper,
      paddingHorizontal: 9,
      paddingVertical: 7,
    },
    locationCaptionText: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
    locationCaptionLabel: { flex: 1, color: theme.ink, fontSize: 11, fontWeight: "700" },
    locationAttribution: { color: theme.secondary, fontSize: 9, textDecorationLine: "underline" },
    section: { gap: 13 },
    sectionHeading: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
    },
    addFileButton: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 8,
    },
    addFileLabel: { color: theme.ember, fontSize: 14, fontWeight: "700" },
    choiceList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      minHeight: 40,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 999,
      backgroundColor: theme.paper,
      paddingHorizontal: 13,
    },
    choiceSelected: {
      backgroundColor: theme.command,
      borderColor: theme.command,
    },
    choiceLabel: { color: theme.secondary, fontSize: 13, fontWeight: "700" },
    choiceLabelSelected: { color: theme.commandText },
    readOnlyStatus: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    controlLabel: {
      color: theme.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      marginTop: 3,
    },
    crewDropdown: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      backgroundColor: theme.paper,
      paddingHorizontal: 14,
    },
    crewDropdownText: {
      flex: 1,
      color: theme.ink,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "600",
    },
    crewDropdownPlaceholder: { color: theme.secondary, fontWeight: "400" },
    fireDropdown: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      backgroundColor: theme.paper,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    fireDropdownCopy: { flex: 1, gap: 3 },
    fireDropdownText: {
      color: theme.ink,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "600",
    },
    fireDropdownMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    clearFireButton: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 2,
    },
    clearFireLabel: { color: theme.danger, fontSize: 14, fontWeight: "700" },
    fireHelp: { color: theme.secondary, fontSize: 13, lineHeight: 19 },
    assignmentButton: {
      minHeight: 46,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.command,
      borderRadius: 10,
      paddingHorizontal: 15,
    },
    assignmentButtonLabel: {
      color: theme.commandText,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
    },
    saveError: {
      color: theme.danger,
      backgroundColor: theme.dangerSurface,
      borderRadius: 10,
      padding: 12,
      fontSize: 13,
      lineHeight: 19,
    },
    disabled: { opacity: 0.45 },
    issueList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    detailIssueRow: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    detailIssueMain: { flex: 1, gap: 4 },
    resolvedIssueIcon: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 15,
      backgroundColor: theme.greenSurface,
    },
    detailIssueTitle: {
      color: theme.ink,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
    },
    detailIssueMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    sectionTitle: {
      color: theme.ink,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "700",
    },
    details: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    detailRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 24,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    detailLabel: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    detailValue: {
      flex: 1,
      color: theme.ink,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      textAlign: "right",
    },
    photoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 70,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.surfaceAlt,
    },
    fileIcon: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      backgroundColor: theme.paper,
    },
    fileAction: {
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    fileActionLabel: { color: theme.ember, fontSize: 13, fontWeight: "700" },
    removeFileButton: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    documents: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    documentRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    disabledDocument: { opacity: 0.58 },
    documentMain: { flex: 1, gap: 3 },
    documentLabel: {
      color: theme.ink,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
    },
    documentName: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    documentType: {
      color: theme.secondary,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "800",
    },
    emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    notes: {
      color: theme.ink,
      backgroundColor: theme.surfaceAlt,
      borderRadius: 12,
      padding: 16,
      fontSize: 15,
      lineHeight: 23,
    },
    updated: {
      color: theme.secondary,
      fontSize: 12,
      lineHeight: 17,
      fontVariant: ["tabular-nums"],
    },
    dangerSection: {
      gap: 9,
      paddingTop: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    dangerTitle: {
      color: theme.danger,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "700",
    },
    dangerCopy: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    deleteButton: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 10,
      backgroundColor: theme.paper,
      paddingHorizontal: 15,
      marginTop: 4,
    },
    deleteButtonLabel: { color: theme.danger, fontSize: 14, fontWeight: "700" },
    message: { paddingVertical: 48, gap: 9 },
    messageTitle: {
      color: theme.ink,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "700",
    },
    messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    retryButton: {
      alignSelf: "flex-start",
      backgroundColor: theme.command,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 11,
      marginTop: 8,
    },
    retryButtonPressed: { opacity: 0.82 },
    retryLabel: { color: theme.commandText, fontSize: 15, fontWeight: "700" },
    modalSafeArea: { flex: 1, backgroundColor: theme.canvas },
    modalHeader: {
      minHeight: 74,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      paddingHorizontal: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    modalHeadingCopy: { flex: 1 },
    modalTitle: {
      color: theme.ink,
      fontSize: 20,
      lineHeight: 25,
      fontWeight: "800",
    },
    modalSubtitle: {
      color: theme.secondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },
    cancelLabel: {
      color: theme.ember,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "700",
    },
    crewSearch: {
      minHeight: 48,
      marginHorizontal: 20,
      marginVertical: 14,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      backgroundColor: theme.paper,
      color: theme.ink,
      paddingHorizontal: 14,
      fontSize: 16,
    },
    documentForm: { paddingTop: 8, gap: 8 },
    fireSearch: {
      minHeight: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginHorizontal: 20,
      marginVertical: 14,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      backgroundColor: theme.paper,
      paddingHorizontal: 14,
    },
    fireSearchInput: {
      flex: 1,
      minHeight: 48,
      color: theme.ink,
      fontSize: 16,
      paddingVertical: 0,
    },
    fireLoading: { alignItems: "center", paddingTop: 28 },
    fireErrorBlock: { alignItems: "center", gap: 4, paddingHorizontal: 20 },
    fireResults: { paddingHorizontal: 20, paddingBottom: 32 },
    fireOption: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    fireIcon: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
      backgroundColor: theme.dangerSurface,
    },
    modalSaveError: {
      color: theme.danger,
      backgroundColor: theme.dangerSurface,
      paddingHorizontal: 20,
      paddingVertical: 12,
      fontSize: 13,
      lineHeight: 19,
    },
    crewResults: { paddingHorizontal: 20, paddingBottom: 24 },
    crewOption: {
      minHeight: 62,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 20,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    crewOptionSelected: { backgroundColor: theme.greenSurface },
    crewOptionCopy: { flex: 1, gap: 3 },
    crewOptionName: {
      flex: 1,
      color: theme.ink,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
    },
    crewOptionMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    crewOptionCheck: {
      color: theme.green,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
    },
    noCrewResults: {
      color: theme.secondary,
      fontSize: 15,
      lineHeight: 22,
      paddingVertical: 36,
      textAlign: "center",
    },
  });
}
