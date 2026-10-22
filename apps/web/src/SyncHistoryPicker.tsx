import {useState} from 'react';
import type {FleetIssue,Vehicle,SyncReviewClient} from '@fireops/domain';
export function SyncHistoryPicker({vehicles,issues,controller}:{vehicles:Vehicle[];issues:FleetIssue[];controller:SyncReviewClient}){
  const [type,setType]=useState<'vehicle'|'issue'>('vehicle');const [id,setId]=useState('');
  const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return <details className="sync-review-notice"><summary>Inspect device edit history (online)</summary><p>Inspect retained reports even after conflicts are resolved. Select a record, or enter its ID for a deleted record. Read-only; not an approval source.</p>
    <label>Record type <select value={type} onChange={event=>{setType(event.target.value as 'vehicle'|'issue');setId('')}}><option value="vehicle">Vehicle</option><option value="issue">Issue</option></select></label>
    <label>Current record <select value={(type==='vehicle'?vehicles:issues).some(item=>item.id===id)?id:''} onChange={event=>setId(event.target.value)}><option value="">Choose record</option>{type==='vehicle'?vehicles.map(item=><option key={item.id} value={item.id}>{item.unit}</option>):issues.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>Record ID <input value={id} onChange={event=>setId(event.target.value.trim())} placeholder="UUID, including deleted records"/></label>
    <button type="button" className="secondary" disabled={!valid} onClick={()=>void controller.openReview({entityType:type,entityId:id.toLowerCase()})}>Open review / device history</button>
  </details>;
}
