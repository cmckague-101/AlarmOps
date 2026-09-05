import { useEffect, useMemo, useState } from "react";
import type { NifcIncident, VehicleStatus } from "@fireops/domain";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
import {
  openFleetFile,
  removeFleetFiles,
  uploadFleetFile,
  type LocalFleetFile,
} from "@/lib/fleet-files";
import {
  createFleetId,
  deleteFleetVehicle,
  refreshFleet,
  updateFleetVehicle,
  updateFleetVehicleFiles,
  useFleetVehicles,
  type FleetVehicleDocument,
  type FleetVehicleFile,
} from "@/lib/fleet-store";
import { fetchNifcIncidents } from "@/lib/nifc";
import { useSession } from "@/providers/session-provider";
import { FireOpsTheme, useFireOpsTheme } from "@/theme";

function displayStatus(status: string) {
  return status
    .trim()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .map((word) =>
      word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : "",
    )
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
const vehicleStatuses: VehicleStatus[] = [
  "Ready",
  "Assigned",
  "Maintenance",
  "Out of service",
];

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId =
    access.value?.kind === "member" ? access.value.company.id : null;
  const user = access.value?.kind === "member" ? access.value.user : null;
  const { vehicles, issues, crew, loading, error } =
    useFleetVehicles(companyId);
  const vehicle = vehicles.find((item) => item.id === id);
  const assignedName = crew.find(
    (member) => member.id === vehicle?.assignedTo,
  )?.name;
  const openIssues = issues.filter(
    (issue) => issue.vehicleId === id && issue.status === "Open",
  );
  const resolvedIssues = issues
    .filter((issue) => issue.vehicleId === id && issue.status === "Resolved")
    .sort(
      (a, b) =>
        Date.parse(b.resolvedAt ?? b.createdAt) -
        Date.parse(a.resolvedAt ?? a.createdAt),
    );
  const activeCrew = crew.filter((member) => member.status === "Active");
  const canManage = user?.role === "owner";
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);
  const [crewQuery, setCrewQuery] = useState("");
  const [fileBusy, setFileBusy] = useState<
    "photo" | "document" | string | null
  >(null);
  const [fileError, setFileError] = useState("");
  const [pendingDocument, setPendingDocument] = useState<LocalFleetFile | null>(
    null,
  );
  const [documentName, setDocumentName] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [cameraCapture, setCameraCapture] = useState<string | null>(null);
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
      .then(setIncidents)
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

  const captureCameraImage = async () => {
    if (!vehicle?.motive || capturing || vehicle.motive.camera?.status === "offline" || vehicle.motive.camera?.status === "unavailable") return;
    setCapturing(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    setCameraCapture(vehicle.motive.camera?.capturedAt ?? new Date().toISOString());
    setCapturing(false);
  };

  const changeStatus = async (status: VehicleStatus) => {
    if (!vehicle || !user || !canManage || vehicle.status === status) return;
    if (status === "Assigned" && !vehicle.assignedTo) {
      setSaveError("Assign crew member before setting status to Assigned.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await updateFleetVehicle(
        vehicle,
        status === "Assigned" ? { status } : { status, clearAssignment: true },
        user,
        {
          action: `${vehicle.name} status changed to ${status}`,
          detail: `Previous status: ${vehicle.status}`,
          tone: ["Maintenance", "Out of service"].includes(status)
            ? "urgent"
            : "complete",
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

  const saveUploadedFile = async (
    localFile: LocalFleetFile,
    patchFor: (file: FleetVehicleFile) => {
      photo?: FleetVehicleFile;
      documents?: FleetVehicleDocument[];
    },
    activity: { action: string; detail: string },
  ) => {
    if (!vehicle || !user || !companyId) return null;
    let uploaded: FleetVehicleFile | null = null;
    try {
      uploaded = await uploadFleetFile(companyId, user.id, localFile);
      await updateFleetVehicleFiles(
        vehicle,
        patchFor(uploaded),
        user,
        activity,
      );
      return uploaded;
    } catch (uploadError) {
      if (uploaded?.path) {
        try {
          await removeFleetFiles([uploaded.path]);
        } catch {
          /* Orphan is safer than deleting a committed file. */
        }
      }
      throw uploadError;
    }
  };

  const choosePhoto = async () => {
    if (!vehicle || !canManage || fileBusy) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const localFile = {
      uri: asset.uri,
      name: asset.fileName ?? `${vehicle.name}-photo.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };
    setFileBusy("photo");
    setFileError("");
    try {
      await saveUploadedFile(localFile, (photo) => ({ photo }), {
        action: `${vehicle.name} photo updated`,
        detail: vehicle.photo
          ? "Vehicle photo replaced"
          : "Vehicle photo added",
      });
      if (vehicle.photo?.path) {
        try {
          await removeFleetFiles([vehicle.photo.path]);
        } catch {
          setFileError("Photo saved. Previous upload could not be cleaned up.");
        }
      }
    } catch (uploadError) {
      setFileError(
        uploadError instanceof Error
          ? uploadError.message
          : "Photo could not be uploaded.",
      );
    } finally {
      setFileBusy(null);
    }
  };

  const chooseDocument = async () => {
    if (!canManage || fileBusy) return;
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPendingDocument({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? null,
    });
    setDocumentName(asset.name.replace(/\.[^.]+$/, ""));
    setFileError("");
  };

  const addDocument = async () => {
    if (!vehicle || !pendingDocument || !documentName.trim() || fileBusy)
      return;
    const namedDocument = documentName.trim();
    setFileBusy("document");
    setFileError("");
    try {
      await saveUploadedFile(
        pendingDocument,
        (file) => ({
          documents: [
            ...vehicle.documents,
            { id: createFleetId(), name: namedDocument, file },
          ],
        }),
        {
          action: `${namedDocument} added to ${vehicle.name}`,
          detail: "Vehicle document uploaded",
        },
      );
      setPendingDocument(null);
      setDocumentName("");
    } catch (uploadError) {
      setFileError(
        uploadError instanceof Error
          ? uploadError.message
          : "Document could not be uploaded.",
      );
    } finally {
      setFileBusy(null);
    }
  };

  const confirmRemoveDocument = (document: FleetVehicleDocument) => {
    if (!vehicle || !user || fileBusy) return;
    Alert.alert(
      "Remove document?",
      `${document.name} will no longer be attached to ${vehicle.name}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setFileBusy(document.id);
            setFileError("");
            void updateFleetVehicleFiles(
              vehicle,
              {
                documents: vehicle.documents.filter(
                  (item) => item.id !== document.id,
                ),
              },
              user,
              {
                action: `${document.name} removed from ${vehicle.name}`,
                detail: "Vehicle document removed",
              },
            )
              .then(async () => {
                try {
                  await removeFleetFiles([document.file.path]);
                } catch {
                  setFileError(
                    "Document removed. Stored upload could not be cleaned up.",
                  );
                }
              })
              .catch((removeError) => {
                setFileError(
                  removeError instanceof Error
                    ? removeError.message
                    : "Document could not be removed.",
                );
              })
              .finally(() => setFileBusy(null));
          },
        },
      ],
    );
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
    if (!vehicle || !user || !canManage || saving || !vehicle.assignedTo)
      return;
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
                      router.push({
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
            <View style={styles.identity}>
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
            </View>

            {vehicle.motive ? (
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Capture Motive camera image"
                  accessibilityState={{ disabled: capturing || ["offline", "unavailable"].includes(vehicle.motive.camera?.status ?? "online") }}
                  disabled={capturing || ["offline", "unavailable"].includes(vehicle.motive.camera?.status ?? "online")}
                  onPress={() => void captureCameraImage()}
                  style={({ pressed }) => [styles.cameraButton, pressed && styles.buttonPressed]}
                >
                  <AppSymbol name={{ ios: "camera.fill", android: "photo_camera" } as never} color={theme.commandText} size={18} />
                  <Text style={styles.cameraButtonLabel}>
                    {capturing ? "Capturing…" : vehicle.motive.camera?.status === "offline" ? "Camera offline" : vehicle.motive.camera?.status === "unavailable" ? "Camera unavailable" : "Camera online · Capture image"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Current status</Text>
              {canManage ? (
                <View style={styles.choiceList}>
                  {vehicleStatuses.map((status) => {
                    const selected = vehicle.status === status;
                    const disabled =
                      saving || (status === "Assigned" && !vehicle.assignedTo);
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
                          {status}
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

            {canManage ? (
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
              <Text style={styles.sectionTitle}>Vehicle information</Text>
              <View style={styles.details}>
                <DetailRow label="Unit" value={vehicle.name} styles={styles} />
                <DetailRow label="Type" value={vehicle.type} styles={styles} />
                <DetailRow label="Year" value={vehicle.year} styles={styles} />
                <DetailRow label="Make" value={vehicle.make} styles={styles} />
                <DetailRow
                  label="Model"
                  value={vehicle.model}
                  styles={styles}
                />
                <DetailRow label="VIN" value={vehicle.vin} styles={styles} />
                <DetailRow
                  label="Plate"
                  value={vehicle.plate}
                  styles={styles}
                />
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>Photo &amp; documents</Text>
                {canManage ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(fileBusy)}
                    onPress={() => void chooseDocument()}
                    style={({ pressed }) => [
                      styles.addFileButton,
                      fileBusy && styles.disabled,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <AppSymbol
                      name={{ ios: "plus", android: "add" } as never}
                      color={theme.ember}
                      size={16}
                    />
                    <Text style={styles.addFileLabel}>Document</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.photoRow}>
                <View style={styles.fileIcon}>
                  <AppSymbol
                    name={{ ios: "photo", android: "image" } as never}
                    color={theme.ember}
                    size={19}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    vehicle.photo
                      ? `Open photo ${vehicle.photo.name}`
                      : "Vehicle photo not attached"
                  }
                  disabled={!vehicle.photo?.path || Boolean(fileBusy)}
                  onPress={() =>
                    vehicle.photo && void openAttachment(vehicle.photo)
                  }
                  style={({ pressed }) => [
                    styles.documentMain,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.documentLabel}>Vehicle photo</Text>
                  <Text style={styles.documentName} numberOfLines={1}>
                    {vehicle.photo?.name ?? "No photo attached"}
                  </Text>
                </Pressable>
                {canManage ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      vehicle.photo
                        ? "Replace vehicle photo"
                        : "Add vehicle photo"
                    }
                    disabled={Boolean(fileBusy)}
                    onPress={() => void choosePhoto()}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.fileAction,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.fileActionLabel}>
                      {fileBusy === "photo"
                        ? "Uploading…"
                        : vehicle.photo
                          ? "Replace"
                          : "Add"}
                    </Text>
                  </Pressable>
                ) : vehicle.photo?.path ? (
                  <AppSymbol
                    name={
                      { ios: "arrow.up.right", android: "open_in_new" } as never
                    }
                    color={theme.secondary}
                    size={17}
                  />
                ) : null}
              </View>
              {vehicle.files.length ? (
                <View style={styles.documents}>
                  {vehicle.files.map(({ label, file }, index) => (
                    <View
                      key={`${label}-${file.name}-${index}`}
                      style={styles.documentRow}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${label}`}
                        disabled={!file.path || Boolean(fileBusy)}
                        onPress={() => void openAttachment(file)}
                        style={({ pressed }) => [
                          styles.documentMain,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.documentLabel}>{label}</Text>
                        <Text style={styles.documentName} numberOfLines={1}>
                          {file.name}
                        </Text>
                      </Pressable>
                      {(() => {
                        const document = vehicle.documents.find(
                          (item) => item.file === file,
                        );
                        return document && canManage ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${document.name}`}
                            disabled={Boolean(fileBusy)}
                            onPress={() => confirmRemoveDocument(document)}
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.removeFileButton,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <AppSymbol
                              name={
                                { ios: "trash", android: "delete" } as never
                              }
                              color={theme.danger}
                              size={17}
                            />
                          </Pressable>
                        ) : file.type ? (
                          <Text style={styles.documentType}>
                            {file.type.split("/").pop()?.toUpperCase()}
                          </Text>
                        ) : null;
                      })()}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>No documents attached.</Text>
              )}
              {fileError ? (
                <Text accessibilityRole="alert" style={styles.saveError}>
                  {fileError}
                </Text>
              ) : null}
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
        animationType="fade"
        onRequestClose={() => setCameraCapture(null)}
        presentationStyle="fullScreen"
        visible={Boolean(cameraCapture)}
      >
        <SafeAreaView style={styles.cameraViewer} edges={["top", "bottom"]}>
          <View style={styles.cameraViewerHeader}>
            <View style={styles.cameraViewerCopy}>
              <Text style={styles.cameraViewerTitle}>{vehicle?.name ?? "Vehicle"} camera image</Text>
              <Text style={styles.cameraViewerTime}>Captured {formattedDate(cameraCapture)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close camera image" hitSlop={10} onPress={() => setCameraCapture(null)} style={styles.cameraClose}>
              <AppSymbol name={{ ios: "xmark", android: "close" } as never} color="#FFFFFF" size={22} />
            </Pressable>
          </View>
          <Image
            accessibilityLabel={`Forward camera capture from ${vehicle?.name ?? "vehicle"}`}
            resizeMode="contain"
            source={vehicle?.motive?.camera?.imageUrl ? { uri: vehicle.motive.camera.imageUrl } : require("../../../assets/images/motive-camera-demo.png")}
            style={styles.cameraImage}
          />
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!fileBusy) setPendingDocument(null);
        }}
        presentationStyle="pageSheet"
        visible={Boolean(pendingDocument)}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Name document</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {pendingDocument?.name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(fileBusy)}
              onPress={() => setPendingDocument(null)}
              hitSlop={10}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.documentForm} keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} keyboardShouldPersistTaps="handled">
            <Text style={styles.controlLabel}>Document name</Text>
            <TextInput
              accessibilityLabel="Document name"
              autoCapitalize="words"
              autoFocus
              editable={!fileBusy}
              maxLength={80}
              onChangeText={setDocumentName}
              placeholder="Registration, inspection, insurance…"
              placeholderTextColor={theme.secondary}
              selectTextOnFocus
              style={styles.crewSearch}
              value={documentName}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!documentName.trim() || Boolean(fileBusy)}
              onPress={() => void addDocument()}
              style={({ pressed }) => [
                styles.assignmentButton,
                (!documentName.trim() || fileBusy) && styles.disabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.assignmentButtonLabel}>
                {fileBusy === "document" ? "Uploading…" : "Upload document"}
              </Text>
            </Pressable>
            {fileError ? (
              <Text accessibilityRole="alert" style={styles.saveError}>
                {fileError}
              </Text>
            ) : null}
          </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

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
    openIssueButton: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      backgroundColor: theme.command,
      borderRadius: 10,
      paddingHorizontal: 16,
      marginTop: 8,
    },
    openIssueLabel: {
      color: theme.commandText,
      fontSize: 14,
      fontWeight: "700",
    },
    buttonPressed: { opacity: 0.76 },
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
    cameraButton: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: "#526158",
      borderRadius: 10,
      paddingHorizontal: 12,
    },
    cameraButtonLabel: { color: theme.commandText, fontSize: 13, fontWeight: "800" },
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
    cameraViewer: { flex: 1, backgroundColor: "#080B0A" },
    cameraViewerHeader: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingHorizontal: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#344039",
    },
    cameraViewerCopy: { flex: 1, gap: 3 },
    cameraViewerTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
    cameraViewerTime: { color: "#AEB8B1", fontSize: 12 },
    cameraClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    cameraImage: { flex: 1, width: "100%" },
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
