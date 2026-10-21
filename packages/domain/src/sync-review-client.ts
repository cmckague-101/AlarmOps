import {
  createSyncPatch, mergeSyncUpdate, suggestSyncReviewChoices, type FleetSyncReview,
  type FleetSyncReviewDecision, type FleetSyncReviewRequest, type SyncFieldValue, type SyncRecord, type SyncJsonValue,
  type SyncReviewFieldProvenance,
} from './offline-sync';

export type SyncReviewTarget = { readonly entityType: 'vehicle' | 'issue'; readonly entityId: string };
export type SyncConflictGroup = SyncReviewTarget & { readonly count: number; readonly receivedAt: string };
export interface SyncReviewTransport {
  list(companyId: string, offset: number, limit: number): Promise<readonly unknown[]>;
  review(companyId: string, target: SyncReviewTarget): Promise<unknown>;
  approve(request: FleetSyncReviewRequest): Promise<unknown>;
}
export type SyncReviewClientState = {
  readonly groups: readonly SyncConflictGroup[];
  readonly status: 'disabled' | 'loading' | 'ready' | 'unavailable' | 'error';
  readonly listError: string;
  readonly target: SyncReviewTarget | null;
  readonly review: FleetSyncReview | null;
  readonly reviewLoading: boolean;
  readonly reviewError: string;
  readonly choices: Readonly<Record<string, string>>;
  readonly approval: 'idle' | 'saving' | 'uncertain';
  readonly decision: FleetSyncReviewDecision | null;
};
export const syncReviewSetupMessage = 'Data-conflict review is not enabled on this database yet. Apply the pending sync migrations first.';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conflict response.');
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid conflict response text.');
}
function date(value: unknown): void { text(value); if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid conflict response date.'); }
function record(value: unknown): asserts value is SyncRecord { createSyncPatch({}, value as SyncRecord); }
function slot(value: unknown): asserts value is SyncFieldValue { mergeSyncUpdate({}, {}, { field: value as SyncFieldValue }); }
function same(left: unknown, right: unknown): boolean {
  return Object.keys(createSyncPatch({ value: left as SyncJsonValue }, { value: right as SyncJsonValue })).length === 0;
}
function provenance(value: unknown): void {
  const data = object(value);
  if (data.userId !== null) text(data.userId);
  if (data.actorName !== null && typeof data.actorName !== 'string') throw new Error('Invalid author.');
  if (!['online','offline','unknown'].includes(String(data.connectivity))) throw new Error('Invalid connectivity.');
  for (const key of ['savedAt','serverRecordedAt','approvedAt']) if (data[key] != null) date(data[key]);
}

/** Validate RPC scope and option references before displaying or choosing any values. */
export function decodeFleetSyncReview(value: unknown, companyId: string, target: SyncReviewTarget): FleetSyncReview {
  record(value);
  const data = object(value);
  if (data.companyId !== companyId || data.entityType !== target.entityType || data.entityId !== target.entityId) throw new Error('Conflict response scope changed.');
  text(data.reviewToken); text(data.currentRevision);
  if (!/^[1-9][0-9]*$/.test(data.currentRevision)) throw new Error('Invalid revision.');
  if (data.currentRecord !== null) { record(data.currentRecord); if (data.currentRecord.id !== target.entityId) throw new Error('Invalid record identity.'); }
  if (!Array.isArray(data.candidates) || !data.candidates.length) throw new Error('Missing conflict candidates.');
  const candidates = new Map<string, Record<string, unknown>>();
  for (const raw of data.candidates) {
    const candidate = object(raw);
    text(candidate.id); text(candidate.operationId); text(candidate.baseRevision); text(candidate.currentRevision); date(candidate.receivedAt);
    record(candidate.baseRecord); record(candidate.proposedRecord);
    if (candidate.currentRecord !== null) record(candidate.currentRecord);
    if (candidate.baseRecord.id !== target.entityId || candidate.proposedRecord.id !== target.entityId
      || (candidate.currentRecord !== null && candidate.currentRecord.id !== target.entityId)
      || !/^[1-9][0-9]*$/.test(candidate.baseRevision) || !/^[1-9][0-9]*$/.test(candidate.currentRevision)
      || !['fields','deleted','recreated'].includes(String(candidate.reason)) || !Array.isArray(candidate.fieldConflicts)
      || (candidate.lifecycleChanged !== undefined && typeof candidate.lifecycleChanged !== 'boolean')) throw new Error('Invalid candidate.');
    provenance(candidate.provenance);
    const author = object(candidate.provenance);
    text(author.userId); text(author.deviceId); date(author.savedAt);
    if (candidates.has(candidate.id)) throw new Error('Duplicate candidate.');
    candidates.set(candidate.id, candidate);
  }
  const allowed = target.entityType === 'vehicle' ? ['unit','type','year','make','model','vin','plate','notes'] : ['title','description','priority'];
  const fields = object(data.fields);
  for (const [key, raw] of Object.entries(fields)) {
    if (!allowed.includes(key)) throw Object.assign(new Error('This conflict needs a newer app version.'), {code:'CLIENT_UPDATE_REQUIRED'});
    const definition = object(raw); slot(definition.current);
    const actual = data.currentRecord !== null && Object.prototype.hasOwnProperty.call(data.currentRecord, key)
      ? { present: true, value: (data.currentRecord as SyncRecord)[key] } : { present: false };
    if (!same(definition.current, actual) || !Array.isArray(definition.options) || !definition.options.length) throw new Error('Invalid review field.');
    const sources = new Set<string>();
    for (const rawOption of definition.options) {
      const option = object(rawOption); text(option.source); slot(option.value); provenance(option.provenance);
      const candidate = candidates.get(option.source);
      if (!candidate || sources.has(option.source)) throw new Error('Invalid candidate source.');
      sources.add(option.source);
      const patch = createSyncPatch(candidate.baseRecord as SyncRecord, candidate.proposedRecord as SyncRecord);
      if (!Object.prototype.hasOwnProperty.call(patch, key) || !same(patch[key], option.value)) throw new Error('Invalid candidate field value.');
    }
  }
  // Never approve a response that omitted an independent candidate field.
  for (const candidate of candidates.values()) for (const key of Object.keys(createSyncPatch(candidate.baseRecord as SyncRecord, candidate.proposedRecord as SyncRecord))) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new Error('Review omitted a candidate field.');
    const options = object(fields[key]).options as { source: string }[];
    if (!options.some(option => option.source === candidate.id)) throw new Error('Review omitted a candidate option.');
  }
  for (const raw of Object.values(object(data.currentProvenance))) provenance(raw);
  return value as FleetSyncReview;
}
function decodeDecision(value: unknown, target: SyncReviewTarget): FleetSyncReviewDecision {
  record(value); const data = object(value);
  if (data.kind !== 'resolved' || !Array.isArray(data.outcomes)) throw new Error('Invalid approval receipt.');
  text(data.decisionId); text(data.revision); date(data.decidedAt);
  if (!/^[1-9][0-9]*$/.test(data.revision)) throw new Error('Invalid approved revision.');
  if (data.record !== null) { record(data.record); if (data.record.id !== target.entityId) throw new Error('Invalid approved record.'); }
  for (const raw of data.outcomes) {
    const item = object(raw); text(item.conflictId); text(item.operationId); text(item.userId);
    if (!['kept','partially_kept','not_selected'].includes(String(item.outcome)) || !Array.isArray(item.keptFields) || !Array.isArray(item.discardedFields)) throw new Error('Invalid review outcome.');
    [...item.keptFields,...item.discardedFields].forEach(text);
  }
  return value as FleetSyncReviewDecision;
}
function code(error: unknown): string { return error && typeof error === 'object' ? String((error as {code?: unknown}).code ?? '') : ''; }
export function isSyncReviewUnavailable(error: unknown): boolean { return ['42P01','42883','PGRST202','PGRST205'].includes(code(error)); }
export function syncReviewLocked(state: SyncReviewClientState): boolean { return state.approval !== 'idle'; }
export function syncReviewCanApprove(state: SyncReviewClientState): boolean {
  return !!state.review && !state.reviewLoading && !syncReviewLocked(state)
    && Object.keys(state.review.fields).every(key => Object.prototype.hasOwnProperty.call(state.choices, key));
}
export function syncReviewFieldLabel(key: string): string {
  return ({unit:'Unit name',type:'Vehicle type',year:'Year',make:'Make',model:'Model',vin:'VIN',plate:'License plate',notes:'Notes',title:'Issue title',description:'Description',priority:'Priority'} as Record<string,string>)[key] ?? key;
}
export function syncReviewValueText(value: SyncFieldValue): string {
  if (!value.present) return 'Not set (removed)';
  if (value.value === null) return 'Not reported (null)';
  if (value.value === '') return 'Empty text';
  return typeof value.value === 'object' ? JSON.stringify(value.value, null, 2) : String(value.value);
}
export function syncReviewAuthorText(author: SyncReviewFieldProvenance | undefined): string {
  if (!author) return 'Unknown author';
  const name = author.actorName?.trim() || (author.userId ? `Company user (${author.userId})` : 'Unknown author');
  const connection = author.connectivity === 'offline' ? 'Saved while offline (reported by app)' : author.connectivity === 'online' ? 'Saved while online (reported by app)' : 'Connection status unknown';
  return `${name} · ${connection}`;
}

/** Online review state shared by web/native. No offline writes or local persistence. */
export function createSyncReviewClient(scope: {companyId: string; userId: string} | null, transport: SyncReviewTransport, createId: () => string) {
  scope = scope ? {...scope} : null;
  let state: SyncReviewClientState = {groups:[],status:scope?'loading':'disabled',listError:'',target:null,review:null,reviewLoading:false,reviewError:'',choices:{},approval:'idle',decision:null};
  const listeners = new Set<() => void>();
  let active = false; let generation = 0; let listVersion = 0; let reviewVersion = 0;
  let request: FleetSyncReviewRequest | null = null;
  const emit = (patch: Partial<SyncReviewClientState>) => { state = {...state,...patch}; listeners.forEach(listener => listener()); };
  const valid = (version: number) => active && generation === version && scope !== null;
  async function refreshGroups() {
    if (!active || !scope) return;
    const epoch = generation; const version = ++listVersion;
    try {
      const rows: unknown[] = []; const limit = 200;
      for (let offset = 0;; offset += limit) {
        const page = await transport.list(scope.companyId, offset, limit);
        if (!valid(epoch) || version !== listVersion) return;
        rows.push(...page); if (page.length < limit) break;
      }
      const groups = new Map<string, SyncConflictGroup>(); const ids = new Set<string>();
      for (const raw of rows) {
        const item = object(raw); text(item.id); text(item.record_id); date(item.received_at);
        if (item.company_id !== scope.companyId || !['vehicle','issue'].includes(String(item.entity_type))) throw new Error('Invalid alert scope.');
        if (ids.has(item.id)) continue; ids.add(item.id);
        const key = `${item.entity_type}:${item.record_id}`; const existing = groups.get(key);
        groups.set(key, {entityType:item.entity_type as 'vehicle'|'issue',entityId:item.record_id,count:(existing?.count??0)+1,receivedAt:existing?.receivedAt??String(item.received_at)});
      }
      emit({groups:[...groups.values()],status:'ready',listError:''});
    } catch (error) {
      if (valid(epoch) && version === listVersion) emit({groups:[],status:isSyncReviewUnavailable(error)?'unavailable':'error',listError:isSyncReviewUnavailable(error)?syncReviewSetupMessage:'Conflict alerts could not be refreshed. Try again.'});
    }
  }
  async function openReview(target: SyncReviewTarget) {
    if (!active || !scope || syncReviewLocked(state)) return;
    const epoch = generation; const version = ++reviewVersion;
    request = null;
    emit({target:{...target},review:null,choices:{},decision:null,reviewLoading:true,reviewError:''});
    try {
      const data = await transport.review(scope.companyId, target);
      if (!valid(epoch) || version !== reviewVersion) return;
      const review = decodeFleetSyncReview(data, scope.companyId, target);
      emit({review,choices:suggestSyncReviewChoices(review),reviewLoading:false});
    } catch (error) {
      if (!valid(epoch) || version !== reviewVersion) return;
      emit({reviewLoading:false,reviewError:isSyncReviewUnavailable(error)?syncReviewSetupMessage:code(error)==='CLIENT_UPDATE_REQUIRED'?'This conflict needs a newer app version. Update the app before reviewing.':code(error)==='55000'?'No pending conflicts remain. Another manager may have resolved this record.':code(error)==='OFFLINE'?'Connect to the internet to load a fresh review.':'Conflict review could not be loaded. Check your access and connection, then try again.'});
      void refreshGroups();
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      active = true; generation += 1;
      if (request && state.approval === 'saving') emit({approval:'uncertain',reviewError:'Approval has not been confirmed. Retry confirmation using the same request.'});
      void refreshGroups();
    },
    stop() { active = false; generation += 1; listVersion += 1; reviewVersion += 1; },
    refreshGroups, openReview,
    closeReview() {
      if (syncReviewLocked(state)) return false;
      reviewVersion += 1; request = null;
      emit({target:null,review:null,choices:{},decision:null,reviewError:'',reviewLoading:false}); return true;
    },
    choose(field: string, source: string) {
      if (!active || !state.review || syncReviewLocked(state)) return;
      if (!Object.prototype.hasOwnProperty.call(state.review.fields, field)) return;
      const definition = state.review.fields[field];
      if (!definition || (source !== 'current' && !definition.options.some(option => option.source === source))) return;
      if (state.review.currentRecord === null && source !== 'current') return;
      request = null; emit({choices:{...state.choices,[field]:source},reviewError:''});
    },
    async approve() {
      if (!active || !scope || !state.target || (!request && !syncReviewCanApprove(state)) || state.approval === 'saving') return;
      const epoch = generation; const target = state.target; const wasUncertain = state.approval === 'uncertain';
      request ??= {companyId:scope.companyId,entityType:target.entityType,entityId:target.entityId,requestId:createId(),reviewToken:state.review!.reviewToken,choices:{...state.choices}};
      // Never send userId: the server attributes the authenticated approver.
      const payload: FleetSyncReviewRequest = {requestId:request.requestId,companyId:request.companyId,entityType:request.entityType,entityId:request.entityId,reviewToken:request.reviewToken,choices:request.choices};
      emit({approval:'saving',reviewError:''});
      try {
        const raw = await transport.approve(payload);
        if (!valid(epoch)) return;
        const decision = decodeDecision(raw,target);
        const candidates = state.review!.candidates;
        if (decision.outcomes.length !== candidates.length || new Set(decision.outcomes.map(item => item.conflictId)).size !== candidates.length
          || decision.outcomes.some(item => !candidates.some(candidate => candidate.id === item.conflictId && candidate.operationId === item.operationId && candidate.provenance.userId === item.userId))) throw new Error('Approval receipt does not match the reviewed candidates.');
        request = null;
        emit({decision,review:null,choices:{},approval:'idle'}); void refreshGroups();
      } catch (error) {
        if (!valid(epoch)) return;
        if (code(error)==='PT409') {
          request = null; emit({approval:'idle',review:null,choices:{},reviewError:'The record or competing proposals changed. Refresh the review and choose again.'}); void refreshGroups();
        } else if (!wasUncertain && (['22023','42501','55000','OFFLINE'].includes(code(error)) || isSyncReviewUnavailable(error))) {
          request = null; emit({approval:'idle',review:null,choices:{},reviewError:isSyncReviewUnavailable(error)?syncReviewSetupMessage:code(error)==='OFFLINE'?'Connect before approving. No approval was sent.':'Approval was not applied. Refresh the review and verify your access.'});
        } else {
          emit({approval:'uncertain',reviewError:'Approval has not been confirmed. Retry confirmation using the same request; do not submit a different approval.'});
        }
      }
    },
  };
}
export type SyncReviewClient = ReturnType<typeof createSyncReviewClient>;
