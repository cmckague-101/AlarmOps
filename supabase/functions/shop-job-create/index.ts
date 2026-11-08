import { authedAdmin, isUuid, json, optionalText, profileName, requireShopWriter, shopBlockerStatuses, shopPriorities, shopStatuses } from '../_shared/fireops-edge.ts';

// Creates a shop job. The job number comes from the database; the opener and
// the "Job created" note use the verified caller.
Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const title = String(body.title ?? '').trim().slice(0, 200);
  const description = String(body.description ?? '').trim().slice(0, 5000);
  const priority = String(body.priority ?? 'medium');
  const status = String(body.status ?? 'queued');
  const kind = String(body.kind ?? 'general');
  const shopArea = optionalText(body.shopArea, 160);
  const fleetVehicleId = optionalText(body.fleetVehicleId, 36);
  const location = optionalText(body.location, 200);
  const blockerReason = optionalText(body.blockerReason, 500);
  const assignToMe = body.assignToMe === true;

  if (!isUuid(companyId)) return json(400, { error: 'Company is invalid.' });
  if (!title) return json(400, { error: 'Title is required.' });
  if (!(shopPriorities as readonly string[]).includes(priority)) return json(400, { error: 'Priority is invalid.' });
  if (!(shopStatuses as readonly string[]).includes(status) || status === 'done') return json(400, { error: 'Status is invalid.' });
  if (kind !== 'general' && kind !== 'fleet') return json(400, { error: 'Job kind is invalid.' });
  if (kind === 'fleet' && (!fleetVehicleId || !isUuid(fleetVehicleId))) return json(400, { error: 'Choose a fleet vehicle.' });
  if ((shopBlockerStatuses as readonly string[]).includes(status) && !blockerReason) {
    return json(400, { error: 'Explain why this job cannot be worked.' });
  }
  if (!(await requireShopWriter(admin, companyId, actor.id))) return json(403, { error: 'Shop write access required.' });

  if (kind === 'fleet') {
    const { data: vehicle } = await admin.from('fleet_vehicles').select('record_id').eq('company_id', companyId).eq('record_id', fleetVehicleId).maybeSingle();
    if (!vehicle) return json(404, { error: 'Vehicle not found.' });
  }

  const openedByName = await profileName(admin, actor.id);
  const { data: job, error } = await admin.from('shop_jobs').insert({
    company_id: companyId,
    title,
    description,
    priority,
    status,
    blocker_reason: blockerReason,
    kind,
    shop_area: kind === 'general' ? shopArea : null,
    fleet_vehicle_id: kind === 'fleet' ? fleetVehicleId : null,
    assigned_tech_id: assignToMe ? actor.id : null,
    location,
    opened_by: actor.id,
    opened_by_name: openedByName,
  }).select('*').single();
  if (error || !job) {
    console.error('shop job create failed', error);
    return json(400, { error: 'Job could not be created.' });
  }

  const notes = [{ company_id: companyId, job_id: job.id, body: `Job created by ${openedByName}`, kind: 'system', author_id: actor.id, author_name: openedByName }];
  if (description) notes.push({ company_id: companyId, job_id: job.id, body: description.slice(0, 4000), kind: 'note', author_id: actor.id, author_name: openedByName });
  const { error: noteError } = await admin.from('shop_job_notes').insert(notes);
  if (noteError) console.error('shop job create note failed', noteError);

  return json(200, { job });
});
