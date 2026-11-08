import { authedAdmin, isShopAssignerRole, isShopWriterRole, isUuid, json, memberRole, profileName } from '../_shared/fireops-edge.ts';

// Assigns a job to the caller ("Assign to me") or, with techId, to another shop
// worker (owners, admins and resource bosses only). A job not started moves to In progress.
Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const jobId = String(body.jobId ?? '');
  const techId = body.techId === undefined || body.techId === null ? actor.id : String(body.techId);
  if (!isUuid(companyId) || !isUuid(jobId) || !isUuid(techId)) return json(400, { error: 'Shop job is invalid.' });
  const actorRole = await memberRole(admin, companyId, actor.id);
  if (!isShopWriterRole(actorRole)) return json(403, { error: 'Shop write access required.' });
  if (techId !== actor.id) {
    if (!isShopAssignerRole(actorRole)) return json(403, { error: 'Only owners, admins and resource bosses assign jobs to others.' });
    if (!isShopWriterRole(await memberRole(admin, companyId, techId))) return json(400, { error: 'Choose a shop worker from this company.' });
  }

  const { data: job, error: jobError } = await admin.from('shop_jobs').select('id, status, assigned_tech_id').eq('company_id', companyId).eq('id', jobId).maybeSingle();
  if (jobError || !job) return json(404, { error: 'Shop job not found.' });
  if (job.assigned_tech_id === techId) return json(200, { job });

  const patch: Record<string, unknown> = { assigned_tech_id: techId };
  if (job.status === 'queued') patch.status = 'progress';
  const { data: updated, error } = await admin.from('shop_jobs').update(patch).eq('id', jobId).eq('company_id', companyId).select('*').single();
  if (error || !updated) {
    console.error('shop job assign failed', error);
    return json(400, { error: 'Could not assign job.' });
  }

  const [name, techName] = await Promise.all([profileName(admin, actor.id), techId === actor.id ? null : profileName(admin, techId)]);
  const { error: noteError } = await admin.from('shop_job_notes').insert({
    company_id: companyId, job_id: jobId, body: techName ? `Assigned to ${techName} by ${name}` : `Assigned to ${name}`, kind: 'system', author_id: actor.id, author_name: name,
  });
  if (noteError) console.error('shop job assign note failed', noteError);

  return json(200, { job: updated });
});
