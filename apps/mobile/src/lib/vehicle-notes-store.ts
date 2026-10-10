import type { VehicleNote } from "@fireops/domain";

import { supabase } from "@/lib/supabase";

type VehicleNoteRow = {
  id: string;
  vehicle_id: string;
  subject: string;
  body: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

function noteFromRow(row: VehicleNoteRow): VehicleNote {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    subject: row.subject,
    body: row.body,
    createdBy: row.created_by_name,
    createdById: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const selection = "id,vehicle_id,subject,body,created_by,created_by_name,created_at,updated_at";

export async function listVehicleNotes(companyId: string, vehicleId: string) {
  if (!supabase) throw new Error("Vehicle notes are unavailable.");
  const { data, error } = await supabase
    .from("vehicle_notes")
    .select(selection)
    .eq("company_id", companyId)
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as VehicleNoteRow[]).map(noteFromRow);
}

export async function saveVehicleNote(
  companyId: string,
  vehicleId: string,
  user: { id: string; name: string },
  values: { id?: string; subject: string; body: string },
) {
  if (!supabase) throw new Error("Vehicle notes are unavailable.");
  const request = values.id
    ? supabase.from("vehicle_notes").update({ subject: values.subject, body: values.body }).eq("company_id", companyId).eq("id", values.id)
    : supabase.from("vehicle_notes").insert({ company_id: companyId, vehicle_id: vehicleId, subject: values.subject, body: values.body, created_by: user.id, created_by_name: user.name });
  const { data, error } = await request.select(selection).single<VehicleNoteRow>();
  if (error) throw new Error(error.message);
  return noteFromRow(data);
}

export async function deleteVehicleNote(companyId: string, noteId: string) {
  if (!supabase) throw new Error("Vehicle notes are unavailable.");
  const { error } = await supabase.from("vehicle_notes").delete().eq("company_id", companyId).eq("id", noteId);
  if (error) throw new Error(error.message);
}
