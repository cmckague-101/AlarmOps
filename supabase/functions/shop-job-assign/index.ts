import { authedAdmin, isUuid, json, profileName, requireShopWriter } from '../_shared/fireops-edge.ts';

// "Assign to me": the caller takes the job; a job not started moves to In progress.
Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const jobId = String(body.jobId ?? '');
  if (!isUuid(companyId) || !isUuid(jobId)) return json(400, { error: 'Shop job is invalid.' });
  if (!(await requireShopWriter(admin, companyId, actor.id))) return json(403, { error: 'Shop write access required.' });

  const { data: job, error: jobError } = await admin.from('shop_jobs').select('id, status, assigned_tech_id').eq('company_id', companyId).eq('id', jobId).maybeSingle();
  if (jobError || !job) return json(404, { error: 'Shop job not found.' });
  if (job.assigned_tech_id === actor.id) return json(200, { job });

  const patch: Record<string, unknown> = { assigned_tech_id: actor.id };
  if (job.status === 'queued') patch.status = 'progress';
  const { data: updated, error } = await admin.from('shop_jobs').update(patch).eq('id', jobId).eq('company_id', companyId).select('*').single();
  if (error || !updated) {
    console.error('shop job assign failed', error);
    return json(400, { error: 'Could not assign job.' });
  }

  const name = await profileName(admin, actor.id);
  const { error: noteError } = await admin.from('shop_job_notes').insert({
    company_id: companyId, job_id: jobId, body: `Assigned to ${name}`, kind: 'system', author_id: actor.id, author_name: name,
  });
  if (noteError) console.error('shop job assign note failed', noteError);

  return json(200, { job: updated });
});
