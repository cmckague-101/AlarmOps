import {useSyncExternalStore} from 'react';
import {deviceHistoryFields,deviceHistoryKey,deviceHistoryValueText,syncReviewFieldLabel,type DeviceHistoryClient} from '@fireops/domain';
const date=(value:string)=>new Date(value).toLocaleString(undefined,{timeZoneName:'short'});
export function SyncDeviceHistory({controller}:{controller:DeviceHistoryClient}){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  if(!state.target)return null;
  return <section className="sync-review-notice" aria-label="Device edit history"><h2>Device edit history (online)</h2>
    <p>Read-only device reports, not canonical authorship or manager approvals. Discarded values here cannot be selected for approval. Device times/connectivity are reported; server receipt times are separate.</p>
    <button type="button" className="secondary" disabled={state.loading} onClick={()=>void controller.list()}>{state.loading?'Loading history…':state.loaded?'Refresh history':'Load backed-up history'}</button>
    {state.error&&<p role="alert">{state.error}</p>}
    {state.loaded&&!state.items.length&&<p>No backed-up device history is available for this record. This does not prove that no earlier device versions existed.</p>}
    {state.items.map(item=><div key={deviceHistoryKey(item)}><p>{item.actorName||item.actorUserId} · Server history received {date(item.receivedAt)} · Operation {item.operationId}</p><button type="button" className="secondary" disabled={state.loading} onClick={()=>void controller.inspect(item)}>Inspect device report · {item.operationId.slice(-8)}</button></div>)}
    {state.nextCursor&&<button type="button" className="secondary" disabled={state.loading} onClick={()=>void controller.list(true)}>Older reports</button>}
    {state.reportLoading&&<p role="status">Loading device report…</p>}{state.reportError&&<p role="alert">{state.reportError}</p>}
    {state.report&&<article><h3>Device-reported versions</h3><p>Authenticated submitter: {state.report.actorName||state.report.actorUserId} ({state.report.actorUserId}). Server history received: {date(state.report.receivedAt)}.</p>
      {state.report.deviceHistory.map((entry,index)=><section key={index}><h4>Local rebase {index+1} · {entry.reason.startsWith('explicit:')?'Explicit device choices':'Automatic independent merge'}</h4>
        <p>Original save (device-reported): {date(entry.before.provenance.savedAt)}. Local rebase (device-reported): {date(entry.createdAt)}. Connectivity (reported): {entry.before.provenance.connectivity}. Device: {entry.before.provenance.deviceId}.</p>
        {deviceHistoryFields(entry).map(field=><div key={field.field}><h4>{syncReviewFieldLabel(field.field)} · {field.choice}</h4><p>Local view when saved</p><pre>{deviceHistoryValueText(field.before)}</pre><p>Saved proposal (retained even if discarded)</p><pre>{deviceHistoryValueText(field.saved)}</pre><p>Downloaded base used for rebase</p><pre>{deviceHistoryValueText(field.downloaded)}</pre><p>Resulting submission, not necessarily shared outcome</p><pre>{deviceHistoryValueText(field.submitted)}</pre></div>)}
        <details><summary>Full device-reported before/after snapshots</summary><pre>{JSON.stringify({before:entry.before,after:entry.after},null,2)}</pre></details>
      </section>)}
    </article>}
  </section>;
}
