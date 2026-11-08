import { authedAdmin, isUuid, json, profileName, requireShopWriter } from '../_shared/fireops-edge.ts';

// Files a repair under a fleet unit at its current Motive odometer. When the
// unit has no Motive reading, a manual reading needs a reason and is written to
// the company audit log.
function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const vehicleId = String(body.vehicleId ?? '');
  const repairTypeText = String(body.repairTypeText ?? '').trim().replace(/\s+/g, ' ');
  const laborHours = body.laborHours === undefined || body.laborHours === null || body.laborHours === '' ? null : finiteNumber(body.laborHours);
  const notes = String(body.notes ?? '').trim();
  const openJob = body.openJob === true;
  const manualReadingValue = finiteNumber(body.manualReadingValue);
  const manualReadingUnit = body.manualReadingUnit === 'hrs' ? 'hrs' : 'miles';
  const manualReason = String(body.manualReason ?? '').trim();

  if (!isUuid(companyId) || !isUuid(vehicleId)) return json(400, { error: 'Vehicle is invalid.' });
  if (!repairTypeText || repairTypeText.length > 120) return json(400, { error: 'Enter a repair type (up to 120 characters).' });
  if (laborHours === undefined || (laborHours !== null && (laborHours < 0 || laborHours > 999))) return json(400, { error: 'Labor hours must be between 0 and 999.' });
  if (notes.length > 4000) return json(400, { error: 'Notes are limited to 4,000 characters.' });
  if (manualReason.length > 500) return json(400, { error: 'Keep the manual reading reason under 500 characters.' });
  if (!(await requireShopWriter(admin, companyId, actor.id))) return json(403, { error: 'Shop write access required.' });

  const { data: vehicle } = await admin.from('fleet_vehicles').select('record_id, data').eq('company_id', companyId).eq('record_id', vehicleId).maybeSingle();
  if (!vehicle) return json(404, { error: 'Vehicle not found.' });
  const unitName = String((vehicle.data as Record<string, unknown> | null)?.unit ?? 'Unit');

  // The Motive sync stores one snapshot entry per VIN-matched FireOps vehicle.
  let readingValue: number | undefined;
  let readingUnit: 'miles' | 'hrs' = 'miles';
  let readingSource: 'motive' | 'manual' = 'motive';
  let motiveLocatedAt: string | null = null;
  const { data: integration } = await admin.from('company_motive_integrations').select('sync_snapshot, last_sync_at').eq('company_id', companyId).maybeSingle();
  const snapshot = (integration?.sync_snapshot ?? null) as { vehicles?: Array<Record<string, unknown>> } | null;
  const entry = snapshot?.vehicles?.find((item) => item.fleetVehicleId === vehicleId);
  const odometer = finiteNumber(entry?.odometerMiles);
  if (odometer !== undefined && odometer >= 0) {
    readingValue = Math.round(odometer * 100) / 100;
    motiveLocatedAt = typeof entry?.updatedAt === 'string' ? entry.updatedAt : integration?.last_sync_at ?? null;
  }

  if (readingValue === undefined) {
    if (manualReadingValue === undefined || manualReadingValue < 0 || !manualReason) {
      return json(400, { error: 'No Motive reading is available. Enter a manual reading and the reason.' });
    }
    readingValue = manualReadingValue;
    readingUnit = manualReadingUnit;
    readingSource = 'manual';
  }

  const now = new Date().toISOString();
  const normalized = normalizeName(repairTypeText);
  const { data: existingType } = await admin.from('repair_types').select('*').eq('company_id', companyId).eq('name_normalized', normalized).maybeSingle();
  let repairType = existingType;
  if (!repairType) {
    const inserted = await admin.from('repair_types').upsert({
      company_id: companyId, name: repairTypeText, name_normalized: normalized, is_custom: true, use_count: 0,
    }, { onConflict: 'company_id,name_normalized', ignoreDuplicates: false }).select('*').single();
    if (inserted.error || !inserted.data) {
      console.error('repair type save failed', inserted.error);
      return json(400, { error: 'Repair type could not be saved.' });
    }
    repairType = inserted.data;
  }
  const counted = await admin.from('repair_types').update({ use_count: (repairType.use_count ?? 0) + 1, last_used_at: now }).eq('id', repairType.id).select('*').single();
  repairType = counted.data ?? repairType;

  const techName = await profileName(admin, actor.id);
  let shopJobId: string | null = null;
  if (openJob) {
    const created = await admin.from('shop_jobs').insert({
      company_id: companyId,
      title: `${repairTypeText} · ${unitName}`.slice(0, 200),
      description: (notes || `Follow-up from a fleet repair on ${unitName}.`).slice(0, 5000),
      priority: 'medium',
      status: 'queued',
      kind: 'fleet',
      fleet_vehicle_id: vehicleId,
      opened_by: actor.id,
      opened_by_name: techName,
    }).select('id').single();
    if (created.error) console.error('follow-up shop job failed', created.error);
    shopJobId = created.data?.id ?? null;
    if (shopJobId) {
      await admin.from('shop_job_notes').insert({
        company_id: companyId, job_id: shopJobId, body: `Opened from a ${repairTypeText} repair by ${techName}`, kind: 'system', author_id: actor.id, author_name: techName,
      });
    }
  }

  const { data: repair, error } = await admin.from('fleet_repairs').insert({
    company_id: companyId,
    fleet_vehicle_id: vehicleId,
    repair_type_id: repairType.id,
    repair_type_text: repairTypeText,
    reading_value: readingValue,
    reading_unit: readingUnit,
    reading_source: readingSource,
    manual_reason: readingSource === 'manual' ? manualReason : null,
    motive_located_at: motiveLocatedAt,
    tech_id: actor.id,
    tech_name: techName,
    labor_hours: laborHours,
    notes,
    shop_job_id: shopJobId,
  }).select('*').single();
  if (error || !repair) {
    console.error('fleet repair save failed', error);
    return json(400, { error: 'Repair could not be filed.' });
  }

  if (readingSource === 'manual') {
    const { error: auditError } = await admin.from('company_audit_log').insert({
      company_id: companyId,
      actor_user_id: actor.id,
      actor_name: techName,
      description: `Manual repair reading on ${unitName} (${readingValue} ${readingUnit}): ${manualReason}`.slice(0, 1000),
    });
    if (auditError) console.error('manual reading audit failed', auditError);
  }

  return json(200, { repair, repairType, shopJobId });
});
