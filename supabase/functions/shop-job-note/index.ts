import { authedAdmin, isUuid, json, optionalText, profileName, requireShopWriter, shopBlockerStatuses, shopStatuses } from '../_shared/fireops-edge.ts';

// Adds a note to a job's activity log, optionally changing its status. The
// database logs the status change itself, naming the caller.
Deno.serve(async (request) => {
  const auth = await authedAdmin(request);
  if (!auth.ok) return auth.response;
  const { actor, admin, body } = auth;

  const companyId = String(body.companyId ?? '');
  const jobId = String(body.jobId ?? '');
  const noteBody = String(body.body ?? '').trim();
  const statusSet = optionalText(body.statusSet, 20);
  const blockerReason = optionalText(body.blockerReason, 500);

  if (!isUuid(companyId) || !isUuid(jobId)) return json(400, { error: 'Shop job is invalid.' });
  if (!noteBody) return json(400, { error: 'Write a note first.' });
  if (noteBody.length > 4000) return json(400, { error: 'Notes are limited to 4,000 characters.' });
  if (statusSet && !(shopStatuses as readonly string[]).includes(statusSet)) return json(400, { error: 'Status is invalid.' });
  if (!(await requireShopWriter(admin, companyId, actor.id))) return json(403, { error: 'Shop write access required.' });

  const { data: job, error: jobError } = await admin.from('shop_jobs').select('id, status, blocker_reason').eq('company_id', companyId).eq('id', jobId).maybeSingle();
  if (jobError || !job) return json(404, { error: 'Shop job not found.' });
  const blocker = statusSet && (shopBlockerStatuses as readonly string[]).includes(statusSet);
  if (blocker && !(blockerReason || job.blocker_reason)) return json(400, { error: 'Explain why this job cannot be worked.' });

  const authorName = await profileName(admin, actor.id);
  const { data: note, error: noteError } = await admin.from('shop_job_notes').insert({
    company_id: companyId,
    job_id: jobId,
    body: noteBody,
    kind: 'note',
    status_set: statusSet && statusSet !== job.status ? statusSet : null,
    author_id: actor.id,
    author_name: authorName,
  }).select('*').single();
  if (noteError || !note) {
    console.error('shop job note failed', noteError);
    return json(400, { error: 'Note could not be saved.' });
  }

  if (statusSet && statusSet !== job.status) {
    const patch: Record<string, unknown> = { status: statusSet };
    if (blocker) patch.blocker_reason = blockerReason ?? job.blocker_reason;
    const { error: updateError } = await admin.from('shop_jobs').update(patch).eq('id', jobId).eq('company_id', companyId);
    if (updateError) {
      console.error('shop job status failed', updateError);
      return json(400, { error: 'The note was saved, but the status could not be changed.' });
    }
  }

  return json(200, { note });
});
