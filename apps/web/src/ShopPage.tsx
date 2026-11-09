import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {
  ArrowDown, ArrowLeft, ArrowUp, ChevronRight, ClipboardList, FileDown, Flame, Gauge,
  Minus, Package, Play, Plus, Truck, Warehouse, Wrench,
} from 'lucide-react';
import {
  SHOP_PARTS_BLOCKER, filterShopJobs, formatRepairReading, groupShopJobsByVehicle, rankShopJobs, recentRepairTypes,
  repairHistoryEntries, repairHistoryHtml, shopBoardStatus, shopBoardStatuses, shopPriorityLabel, shopStatusLabel,
  suggestRepairTypes, validateFleetRepairDraft, validateShopJobBlocker,
  type FireOpsUser, type FleetIssue, type RepairType, type ShopBoardFilter, type ShopJob, type ShopJobNote,
  type ShopJobPriority, type ShopJobStatus, type Vehicle,
} from '@fireops/domain';
import {useShop, type ShopJobDraft} from './useShop';
import './ShopPage.css';

type BoardFocus = null | 'critical' | 'general' | string;
export type MotiveReading = {value:number;unit:'miles'|'hrs';locatedAt?:string};

const priorityIcon = {critical:Flame, high:ArrowUp, medium:Minus, low:ArrowDown} as const;
const priorities:ShopJobPriority[] = ['critical','high','medium','low'];
const statusIcon = {queued:ClipboardList, progress:Play, parts:Package} as const;

type Props = {
  companyId?:string;
  user:FireOpsUser;
  vehicles:Vehicle[];
  issues:FleetIssue[];
  canWork:boolean;
  /** Owners, admins and resource bosses may assign jobs to any of these shop workers. */
  canAssign?:boolean;
  mechanics?:{id:string;name:string}[];
  demoMode?:boolean;
  onBack:()=>void;
  onResolveLinkedIssue:(issueId:string)=>void;
  motiveReadingFor:(vehicle:Vehicle)=>MotiveReading|null;
  /** Shop job to open once it loads (e.g. from the dashboard's Needs Attention card). */
  requestedJobId?:string|null;
  onJobOpened?:()=>void;
};

function priorityStripeClass(priority:ShopJobPriority) {
  return priority === 'critical' || priority === 'high' ? 'priority-urgent' : 'priority-standard';
}

function printHtml(html:string) {
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.write(`${html}<script>window.onload=()=>window.print()<\/script>`);
  popup.document.close();
  return true;
}

export default function ShopPage({companyId, user, vehicles, issues, canWork, canAssign=false, mechanics=[], demoMode=false, onBack, onResolveLinkedIssue, motiveReadingFor, requestedJobId, onJobOpened}:Props) {
  const shop = useShop(demoMode ? undefined : companyId);
  const [filter, setFilter] = useState<ShopBoardFilter>('open');
  const [query, setQuery] = useState('');
  const [boardFocus, setBoardFocus] = useState<BoardFocus>(null);
  const [showRepairHistory, setShowRepairHistory] = useState(false);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [creating, setCreating] = useState(false);
  const [repairVehicleId, setRepairVehicleId] = useState<string|null>(null);

  useEffect(()=>{setShowRepairHistory(false);}, [boardFocus]);
  useEffect(()=>{
    if (!requestedJobId || shop.loading) return;
    if (shop.jobs.some(job=>job.id === requestedJobId)) setSelectedId(requestedJobId);
    onJobOpened?.();
  }, [requestedJobId, shop.loading, shop.jobs, onJobOpened]);

  const vehicleById = useMemo(()=>new Map(vehicles.map(vehicle=>[vehicle.id, vehicle])), [vehicles]);
  const unitFor = (job:ShopJob)=>job.fleetVehicleId ? vehicleById.get(job.fleetVehicleId)?.unit : undefined;
  const openJobs = useMemo(()=>shop.jobs.filter(job=>job.status !== 'done'), [shop.jobs]);
  const visible = useMemo(()=>rankShopJobs(filterShopJobs(shop.jobs, filter, query, job=>job.fleetVehicleId ? vehicleById.get(job.fleetVehicleId)?.unit : undefined)), [shop.jobs, filter, query, vehicleById]);
  const generalJobs = visible.filter(job=>job.kind === 'general');
  const criticalJobs = visible.filter(job=>job.priority === 'critical');
  const vehicleGroups = useMemo(()=>groupShopJobsByVehicle(vehicles, visible, shop.jobs), [vehicles, visible, shop.jobs]);
  const focusedVehicle = boardFocus && boardFocus !== 'general' && boardFocus !== 'critical' ? vehicleById.get(boardFocus) ?? null : null;
  const focusedJobs = boardFocus === 'critical' ? criticalJobs : boardFocus === 'general' ? generalJobs
    : focusedVehicle ? visible.filter(job=>job.fleetVehicleId === focusedVehicle.id) : [];

  const repairHistory = useMemo(()=>{
    if (boardFocus === 'general') return repairHistoryEntries(shop.jobs.filter(job=>job.kind === 'general'), [], shop.notes);
    if (!focusedVehicle) return [];
    return repairHistoryEntries(shop.jobs.filter(job=>job.fleetVehicleId === focusedVehicle.id), shop.repairs.filter(repair=>repair.fleetVehicleId === focusedVehicle.id), shop.notes);
  }, [boardFocus, focusedVehicle, shop.jobs, shop.notes, shop.repairs]);
  const repairHistorySubject = boardFocus === 'general' ? {title:'General shop', subtitle:'Completed repairs'}
    : focusedVehicle ? {title:focusedVehicle.unit, subtitle:`${focusedVehicle.type} · Completed repairs`} : {title:'Repair history', subtitle:'Completed repairs'};

  const selected = shop.jobs.find(job=>job.id === selectedId) ?? null;
  const taskContextLabel = (job:ShopJob)=>job.kind === 'fleet' ? unitFor(job) ?? 'Fleet' : job.shopArea?.trim() || 'General shop';

  const saveStatus = async (job:ShopJob, status:ShopJobStatus)=>{
    if (status === job.status) return;
    await shop.updateJob(job.id, {status, blockerReason:status === 'parts' ? job.blockerReason || SHOP_PARTS_BLOCKER : null});
    if (status === 'done') {
      const issue = job.sourceFleetIssueId ? issues.find(item=>item.id === job.sourceFleetIssueId) : undefined;
      if (issue?.status === 'Open') onResolveLinkedIssue(issue.id);
      setSelectedId(null);
    }
  };

  const deleteJob = async (job:ShopJob)=>{
    if (!window.confirm(`Delete “${job.title}”? This cannot be undone.`)) return;
    await shop.deleteJob(job.id);
    setSelectedId(null);
  };

  const createJob = async (draft:ShopJobDraft)=>{
    const job = await shop.createJob(draft);
    setCreating(false);
    setBoardFocus(job.kind === 'fleet' && job.fleetVehicleId ? job.fleetVehicleId : 'general');
    setSelectedId(job.id);
  };

  const exportRepairHistory = ()=>{
    if (!printHtml(repairHistoryHtml(repairHistorySubject, repairHistory))) window.alert('Allow pop-ups to export the repair history PDF.');
  };

  const status = demoMode ? <p className="shop-hint" role="status">Shop jobs are saved to your company account and aren’t available in the demo.</p>
    : !shop.connected ? <p className="shop-hint" role="status">Shop jobs need a connected company account.</p>
    : shop.error ? <p className="receipt-error" role="alert">{shop.error} <button type="button" className="secondary" onClick={()=>{shop.clearError();shop.refresh();}}>Retry</button></p>
    : null;

  if (selected) {
    return (
      <div className="page shop-page">
        <button type="button" className="shop-back" onClick={()=>setSelectedId(null)}><ArrowLeft/> Back</button>
        {status}
        <JobDetailPanel
          key={selected.id}
          job={selected}
          unit={unitFor(selected)}
          notes={shop.notes.filter(note=>note.jobId === selected.id)}
          canWork={canWork}
          busy={shop.busy}
          assignedToMe={selected.assignedTechId === user.id}
          onAssign={()=>void shop.assignToMe(selected.id).catch(()=>undefined)}
          mechanics={canAssign ? mechanics : undefined}
          onAssignTech={techId=>void shop.assignTech(selected.id, techId).catch(()=>undefined)}
          onPriority={priority=>void shop.updateJob(selected.id, {priority}).catch(()=>undefined)}
          onStatus={value=>void saveStatus(selected, value).catch(()=>undefined)}
          onNote={body=>shop.addNote(selected.id, body).then(()=>true, ()=>false)}
          onDelete={()=>void deleteJob(selected).catch(()=>undefined)}
        />
      </div>
    );
  }

  return (
    <div className="page shop-page">
      {!boardFocus ? <button type="button" className="shop-back" onClick={onBack}><ArrowLeft/> Back</button> : null}
      <div className="page-heading shop-heading hero-heading">
        <h1>Shop tasks</h1>
        {canWork && shop.connected ? <button type="button" className="primary" onClick={()=>{setCreating(true);setSelectedId(null);}}><Plus/> New shop task</button> : null}
      </div>
      {status}
      {shop.loading ? <p className="shop-hint" role="status">Loading shop jobs…</p> : null}

      {boardFocus ? (
        <section className="shop-vehicle-detail">
          <button type="button" className="shop-back" onClick={()=>{if (showRepairHistory) setShowRepairHistory(false); else setBoardFocus(null);}}>
            <ArrowLeft/> Back
          </button>
          {boardFocus === 'critical' ? (
            <header className="shop-vehicle-hero">
              <span className="shop-vehicle-photo placeholder critical"><Flame/></span>
              <div><h2>Critical tasks</h2><p>Open critical work across fleet and general shop</p></div>
            </header>
          ) : boardFocus === 'general' ? (
            <header className="shop-vehicle-hero">
              <span className="shop-vehicle-photo placeholder"><Warehouse/></span>
              <div><h2>{showRepairHistory ? 'Repair history' : 'General shop'}</h2><p>{showRepairHistory ? 'Completed repairs' : 'Tasks not tied to a fleet vehicle'}</p></div>
            </header>
          ) : focusedVehicle ? (
            <header className="shop-vehicle-hero">
              {focusedVehicle.photo?.dataUrl ? <img className="shop-vehicle-photo" src={focusedVehicle.photo.dataUrl} alt={focusedVehicle.unit}/> : <span className="shop-vehicle-photo placeholder"><Truck/></span>}
              <div>
                <h2>{showRepairHistory ? 'Repair history' : focusedVehicle.unit}</h2>
                <p>{showRepairHistory ? `${focusedVehicle.unit} · Completed repairs` : `${focusedVehicle.type} · ${focusedJobs.length} ${focusedJobs.length === 1 ? 'task' : 'tasks'} to complete`}</p>
              </div>
            </header>
          ) : <p className="shop-hint">This unit is no longer in the fleet.</p>}

          {showRepairHistory && boardFocus !== 'critical' ? (
            <div className="shop-history">
              <div className="shop-history-toolbar">
                <button type="button" className="secondary shop-history-export" disabled={!repairHistory.length} onClick={exportRepairHistory}><FileDown/> Export PDF</button>
              </div>
              {repairHistory.length ? (
                <div className="shop-task-list shop-history-list">
                  {repairHistory.map(entry=>(
                    <button key={entry.id} type="button" className="shop-task-row shop-task-row-closed priority-standard" disabled={!entry.jobId} onClick={()=>entry.jobId && setSelectedId(entry.jobId)}>
                      <span className="shop-task-main">
                        <span className="shop-job-top">{entry.title}</span>
                        <small>{entry.meta} · {entry.kind === 'job' ? 'Closed' : 'Filed'} {new Date(entry.date).toLocaleDateString()}</small>
                        {entry.notes.trim() ? <small className="shop-history-notes">{entry.notes.trim()}</small> : null}
                      </span>
                      <i className="shop-status-label shop-status-done">{entry.kind === 'job' ? 'Closed' : 'Repair'}</i>
                      {entry.jobId ? <ChevronRight className="shop-task-chevron"/> : <span/>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty"><Wrench/><h3>No repair history</h3><p>Closed work for this {boardFocus === 'general' ? 'shop area' : 'unit'} will show up here.</p></div>
              )}
            </div>
          ) : (
            <>
              <div className="shop-board-controls shop-vehicle-controls">
                <StatusFilter value={filter} onChange={setFilter}/>
                {canWork && shop.connected && boardFocus !== 'critical' ? (
                  <span className="shop-assign-row">
                    <button type="button" className="secondary" onClick={()=>setCreating(true)}><Plus/> Add task</button>
                    {focusedVehicle ? <button type="button" className="secondary" onClick={()=>setRepairVehicleId(focusedVehicle.id)}><Gauge/> Log repair</button> : null}
                  </span>
                ) : null}
              </div>
              <h3 className="shop-tasks-heading">Tasks to complete</h3>
              <div className="shop-task-list">
                {focusedJobs.map(job=>(
                  <button key={job.id} type="button" className={`shop-task-row ${priorityStripeClass(job.priority)}`} onClick={()=>setSelectedId(job.id)}>
                    <span className="shop-task-main">
                      <span className="shop-job-top">{job.title}</span>
                      {job.blockerReason ? <small className="shop-blocker">{job.blockerReason}</small> : null}
                      <small>
                        {boardFocus === 'critical' ? `${taskContextLabel(job)} · ` : ''}
                        {job.sourceFleetIssueId ? 'Fleet issue · ' : ''}
                        {shopPriorityLabel(job.priority)} · {job.assignedTechName ?? 'Unassigned'}
                      </small>
                    </span>
                    <i className={`shop-status-label shop-status-${shopBoardStatus(job.status)}`}>{shopStatusLabel(job.status)}</i>
                    <ChevronRight className="shop-task-chevron"/>
                  </button>
                ))}
                {!focusedJobs.length ? (
                  <div className="empty"><Wrench/><h3>No open tasks</h3><p>{boardFocus === 'critical' ? 'No open critical tasks right now.' : `Add a task for this ${boardFocus === 'general' ? 'shop area' : 'unit'}.`}</p></div>
                ) : null}
              </div>
              {boardFocus !== 'critical' ? (
                <button type="button" className="shop-history-button" onClick={()=>setShowRepairHistory(true)}>
                  Repair history{repairHistory.length ? ` (${repairHistory.length})` : ''}
                </button>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <section className="shop-vehicle-board">
          <div className="shop-board-controls">
            <StatusFilter value={filter} onChange={setFilter}/>
            <input aria-label="Search shop jobs" placeholder="Search units or jobs…" value={query} onChange={event=>setQuery(event.target.value)}/>
          </div>
          <div className="shop-vehicle-list">
            <BoardCard icon={<Flame/>} critical title="Critical tasks" subtitle="Open critical work across fleet and general shop"
              count={openJobs.filter(job=>job.priority === 'critical').length} jobs={criticalJobs} onClick={()=>setBoardFocus('critical')}/>
            <BoardCard icon={<Warehouse/>} title="General shop" subtitle="Not tied to a fleet vehicle"
              count={openJobs.filter(job=>job.kind === 'general').length} jobs={generalJobs} onClick={()=>setBoardFocus('general')}/>
            {vehicleGroups.map(({vehicle, jobs, openCount})=>(
              <BoardCard key={vehicle.id} photo={vehicle.photo?.dataUrl} icon={<Truck/>} title={vehicle.unit} subtitle={vehicle.type}
                count={openCount} jobs={jobs} onClick={()=>setBoardFocus(vehicle.id)}/>
            ))}
          </div>
          {canWork && shop.connected && vehicles.length ? (
            <div className="shop-board-controls">
              <button type="button" className="secondary" onClick={()=>setRepairVehicleId(vehicles[0]!.id)}><Gauge/> Log a fleet repair</button>
            </div>
          ) : null}
        </section>
      )}

      {creating ? (
        <NewJobDrawer vehicles={vehicles} defaultVehicleId={focusedVehicle?.id} defaultKind={boardFocus === 'general' ? 'general' : focusedVehicle ? 'fleet' : 'general'}
          busy={shop.busy} error={shop.error} onClose={()=>{setCreating(false);shop.clearError();}} onCreate={draft=>void createJob(draft).catch(()=>undefined)}/>
      ) : null}
      {repairVehicleId ? (
        <RepairDrawer vehicles={vehicles} vehicleId={repairVehicleId} onVehicleId={setRepairVehicleId} repairTypes={shop.repairTypes}
          motiveReadingFor={motiveReadingFor} busy={shop.busy} error={shop.error}
          onClose={()=>{setRepairVehicleId(null);shop.clearError();}}
          onFile={async request=>{
            await shop.fileRepair(request);
            setRepairVehicleId(null);
            setBoardFocus(request.vehicleId);
            setShowRepairHistory(!request.openJob);
          }}/>
      ) : null}
    </div>
  );
}

function StatusFilter({value, onChange}:{value:ShopBoardFilter;onChange:(value:ShopBoardFilter)=>void}) {
  return (
    <label className="shop-status-filter">
      <span className="sr-only">Filter by status</span>
      <select aria-label="Filter shop jobs" value={value} onChange={event=>onChange(event.target.value as ShopBoardFilter)}>
        <option value="open">All open</option>
        {shopBoardStatuses.map(status=><option key={status} value={status}>{shopStatusLabel(status)}</option>)}
      </select>
    </label>
  );
}

function BoardCard({icon, photo, critical=false, title, subtitle, count, jobs, onClick}:{icon:ReactNode;photo?:string;critical?:boolean;title:string;subtitle:string;count:number;jobs:ShopJob[];onClick:()=>void}) {
  return (
    <button type="button" className={`shop-vehicle-card${critical ? ' shop-critical-card' : ''}`} onClick={onClick}>
      {photo ? <img className="shop-vehicle-photo" src={photo} alt=""/> : <span className={`shop-vehicle-photo placeholder${critical ? ' critical' : ''}`}>{icon}</span>}
      <span className="shop-vehicle-copy">
        <b>{title}</b>
        <small>{subtitle}</small>
        <small>{count} {count === 1 ? 'task' : 'tasks'} to complete</small>
        {jobs[0] ? <small className="shop-vehicle-preview">{jobs[0].title}{jobs.length > 1 ? ` +${jobs.length - 1} more` : ''}</small> : null}
      </span>
      <ChevronRight/>
    </button>
  );
}

function JobDetailPanel({job, unit, notes, canWork, busy, assignedToMe, onAssign, mechanics, onAssignTech, onPriority, onStatus, onNote, onDelete}:{
  job:ShopJob;unit?:string;notes:ShopJobNote[];canWork:boolean;busy:boolean;assignedToMe:boolean;
  onAssign:()=>void;mechanics?:{id:string;name:string}[];onAssignTech:(techId:string)=>void;onPriority:(priority:ShopJobPriority)=>void;onStatus:(status:ShopJobStatus)=>void;onNote:(body:string)=>Promise<boolean>;onDelete:()=>void;
}) {
  const [noteText, setNoteText] = useState('');
  const thread = [...notes].sort((a, b)=>Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const context = job.kind === 'fleet' ? unit ?? 'Fleet unit' : job.shopArea?.trim() || 'General shop';
  return (
    <section className="shop-job-panel" aria-label={job.title}>
      <header className="shop-job-panel-header">
        <div>
          <h2>{job.title}</h2>
          <p>{job.jobNumber} · {context} · {job.sourceFleetIssueId ? 'From fleet issue · ' : ''}{shopPriorityLabel(job.priority)} priority · Opened {new Date(job.openedAt).toLocaleString()} by {job.openedByName}</p>
          {job.assignedTechName ? <p>Assigned to {job.assignedTechName}</p> : null}
        </div>
        {canWork && job.status !== 'done' ? (
          <button type="button" className={`primary shop-assign-top ${assignedToMe ? 'assigned' : ''}`} onClick={onAssign} disabled={assignedToMe || busy}>
            {assignedToMe ? 'Assigned to me' : 'Assign to me'}
          </button>
        ) : null}
      </header>
      <div className="shop-drawer-body">
        {mechanics && job.status !== 'done' ? (
          <label>
            <span>Assigned mechanic</span>
            <select value={job.assignedTechId ?? ''} disabled={busy} onChange={event=>{if (event.target.value) onAssignTech(event.target.value);}}>
              {!job.assignedTechId ? <option value="">Unassigned</option> : null}
              {job.assignedTechId && !mechanics.some(mechanic=>mechanic.id === job.assignedTechId) ? <option value={job.assignedTechId}>{job.assignedTechName ?? 'Assigned'}</option> : null}
              {mechanics.map(mechanic=><option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}
            </select>
          </label>
        ) : null}
        {job.description.trim() ? <p className="shop-hint">{job.description}</p> : null}
        {job.blockerReason ? <p className="shop-blocker">{job.blockerReason}</p> : null}
        {canWork && job.status !== 'done' ? (
          <>
            <div className="shop-status-block">
              <h3>Priority</h3>
              <div className="shop-priority-seg" role="radiogroup" aria-label="Job priority">
                {priorities.map(value=>{const Icon = priorityIcon[value];return (
                  <button key={value} type="button" role="radio" aria-checked={job.priority === value} disabled={busy}
                    className={`shop-priority-${value}${job.priority === value ? ' selected' : ''}`} onClick={()=>value !== job.priority && onPriority(value)}>
                    <Icon size={16}/> {shopPriorityLabel(value)}
                  </button>
                );})}
              </div>
            </div>
            <div className="shop-status-block">
              <h3>Status</h3>
              <div className="shop-status-seg shop-status-seg-action" role="radiogroup" aria-label="Job status">
                {shopBoardStatuses.map(value=>(
                  <button key={value} type="button" role="radio" aria-checked={job.status === value} disabled={busy}
                    className={`shop-status-${value}${job.status === value ? ' selected' : ''}`} onClick={()=>onStatus(value)}>
                    {shopStatusLabel(value)}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
        <div className="shop-status-block">
          <h3>Notes</h3>
          {canWork ? (
            <form className="shop-note-compose" onSubmit={event=>{event.preventDefault();const body=noteText.trim();if(!body)return;void onNote(body).then(saved=>{if(saved)setNoteText('');});}}>
              <label><span className="sr-only">Add a note</span>
                <textarea value={noteText} maxLength={4000} onChange={event=>setNoteText(event.target.value)} rows={4} placeholder="Parts used, findings, next steps…"/>
              </label>
              <button type="submit" className="secondary" disabled={busy || !noteText.trim()}>Add note</button>
            </form>
          ) : null}
          <div className="shop-note-thread">
            {thread.map(note=>(
              <article key={note.id} className={`shop-note${note.kind === 'system' ? ' system' : ''}`}>
                <header><b>{note.authorName}</b><time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time></header>
                <p>{note.body}</p>
              </article>
            ))}
            {!thread.length ? <p className="shop-hint">No notes yet.</p> : null}
          </div>
        </div>
      </div>
      {canWork ? (
        <footer className="shop-job-panel-footer">
          {job.status === 'done' ? (
            <>
              <button type="button" className="secondary" disabled={busy} onClick={()=>onStatus('queued')}>Reopen task</button>
              <button type="button" className="shop-delete-button" disabled={busy} onClick={onDelete}>Delete</button>
            </>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={()=>onStatus('done')}>Close task</button>
          )}
        </footer>
      ) : null}
    </section>
  );
}

function NewJobDrawer({vehicles, defaultVehicleId, defaultKind, busy, error, onClose, onCreate}:{
  vehicles:Vehicle[];defaultVehicleId?:string;defaultKind:'general'|'fleet';busy:boolean;error:string;onClose:()=>void;onCreate:(draft:ShopJobDraft)=>void;
}) {
  const [kind, setKind] = useState<'general'|'fleet'>(defaultKind);
  const [shopArea, setShopArea] = useState('');
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ShopJobPriority>('medium');
  const [status, setStatus] = useState<ShopJobStatus>('queued');
  const [assignToMe, setAssignToMe] = useState(false);
  const [problem, setProblem] = useState('');
  const vehicle = vehicles.find(item=>item.id === vehicleId);

  const submit = ()=>{
    const resolvedTitle = title.trim() || description.trim().split('\n')[0]?.slice(0, 160) || '';
    if (!resolvedTitle) {setProblem('Give the task a title.');return;}
    if (kind === 'fleet' && !vehicle) {setProblem('Choose the unit.');return;}
    const blockerReason = status === 'parts' ? SHOP_PARTS_BLOCKER : undefined;
    const blockerError = validateShopJobBlocker(status, blockerReason);
    if (blockerError) {setProblem(blockerError);return;}
    setProblem('');
    onCreate({title:resolvedTitle, description:description.trim(), priority, status, blockerReason, kind,
      shopArea:kind === 'general' ? shopArea.trim() || undefined : undefined, fleetVehicleId:kind === 'fleet' ? vehicleId : undefined, assignToMe});
  };

  return (
    <div className="overlay">
      <section className="drawer shop-drawer" role="dialog" aria-modal="true" aria-label="New shop task">
        <header>
          <div><h2>New shop task</h2></div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="shop-drawer-body">
          <div className="shop-kind-toggle" role="radiogroup" aria-label="Job kind">
            <button type="button" role="radio" aria-checked={kind === 'general'} className={kind === 'general' ? 'selected' : ''} onClick={()=>setKind('general')}>General shop</button>
            <button type="button" role="radio" aria-checked={kind === 'fleet'} className={kind === 'fleet' ? 'selected' : ''} onClick={()=>setKind('fleet')}>Fleet vehicle</button>
          </div>
          {kind === 'general' ? (
            <label>Shop area or equipment<input value={shopArea} maxLength={160} onChange={event=>setShopArea(event.target.value)} placeholder="Tool room, Saw shop…"/></label>
          ) : (
            <label>Unit
              <select value={vehicleId} onChange={event=>setVehicleId(event.target.value)}>
                <option value="">Select unit</option>
                {vehicles.map(item=><option key={item.id} value={item.id}>{item.unit}</option>)}
              </select>
            </label>
          )}
          <label>Title<input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Short task title" maxLength={160}/></label>
          <label>Description<textarea value={description} maxLength={4000} onChange={event=>setDescription(event.target.value)} rows={3} placeholder="Describe the work needed"/></label>
          <div className="shop-priority-seg" role="radiogroup" aria-label="Priority">
            {priorities.map(value=>{const Icon = priorityIcon[value];return (
              <button key={value} type="button" role="radio" aria-checked={priority === value} className={`shop-priority-${value}${priority === value ? ' selected' : ''}`} onClick={()=>setPriority(value)}>
                <Icon size={16}/> {shopPriorityLabel(value)}
              </button>
            );})}
          </div>
          <label className="shop-check"><input type="checkbox" checked={assignToMe} onChange={event=>setAssignToMe(event.target.checked)}/> Assign to me</label>
          <div className="shop-status-seg" role="radiogroup" aria-label="Starting status">
            {shopBoardStatuses.map(value=>{const Icon = statusIcon[value as keyof typeof statusIcon];return (
              <button key={value} type="button" role="radio" aria-checked={status === value} className={`shop-status-${value}${status === value ? ' selected' : ''}`} onClick={()=>setStatus(value)}>
                {Icon ? <Icon size={15}/> : null} {shopStatusLabel(value)}
              </button>
            );})}
          </div>
          {problem || error ? <p className="receipt-error" role="alert">{problem || error}</p> : null}
        </div>
        <footer className="shop-new-job-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={busy} onClick={submit}><Plus/> {busy ? 'Creating…' : 'Create task'}</button>
        </footer>
      </section>
    </div>
  );
}

function RepairDrawer({vehicles, vehicleId, onVehicleId, repairTypes, motiveReadingFor, busy, error, onClose, onFile}:{
  vehicles:Vehicle[];vehicleId:string;onVehicleId:(id:string)=>void;repairTypes:RepairType[];motiveReadingFor:(vehicle:Vehicle)=>MotiveReading|null;
  busy:boolean;error:string;onClose:()=>void;
  onFile:(request:{vehicleId:string;repairTypeText:string;laborHours?:number;notes?:string;openJob?:boolean;manualReadingValue?:number;manualReadingUnit?:'miles'|'hrs';manualReason?:string})=>Promise<void>;
}) {
  const vehicle = vehicles.find(item=>item.id === vehicleId);
  const motive = vehicle ? motiveReadingFor(vehicle) : null;
  const [repairTypeText, setRepairTypeText] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [notes, setNotes] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [manualUnit, setManualUnit] = useState<'miles'|'hrs'>('miles');
  const [manualReason, setManualReason] = useState('');
  const [openJob, setOpenJob] = useState(false);
  const [problem, setProblem] = useState('');
  const suggestions = repairTypeText.trim() ? suggestRepairTypes(repairTypes, repairTypeText, 6).filter(type=>type.nameNormalized !== repairTypeText.trim().toLowerCase()) : [];
  const quickPicks = recentRepairTypes(repairTypes).length ? recentRepairTypes(repairTypes) : suggestRepairTypes(repairTypes, '', 6);

  const submit = ()=>{
    const draftError = validateFleetRepairDraft({repairTypeText, hasMotiveReading:Boolean(motive), manualReadingValue:manualValue, manualReason, laborHours});
    if (draftError || !vehicle) {setProblem(draftError ?? 'Choose the unit.');return;}
    setProblem('');
    void onFile({
      vehicleId:vehicle.id, repairTypeText:repairTypeText.trim(), notes:notes.trim(), openJob,
      laborHours:laborHours.trim() ? Number(laborHours) : undefined,
      ...(motive ? {} : {manualReadingValue:Number(manualValue), manualReadingUnit:manualUnit, manualReason:manualReason.trim()}),
    }).catch(()=>undefined);
  };

  return (
    <div className="overlay">
      <section className="drawer shop-drawer" role="dialog" aria-modal="true" aria-label="Log a fleet repair">
        <header>
          <div><h2>Log a fleet repair</h2></div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="shop-drawer-body">
          <label>Unit
            <select value={vehicleId} onChange={event=>onVehicleId(event.target.value)}>
              {vehicles.map(item=><option key={item.id} value={item.id}>{item.unit}</option>)}
            </select>
          </label>
          <label>Repair type
            <input value={repairTypeText} maxLength={120} onChange={event=>setRepairTypeText(event.target.value)} placeholder="Brakes, Oil change…" autoComplete="off"/>
          </label>
          {suggestions.length ? (
            <div className="shop-note-chips" aria-label="Matching repair types">
              {suggestions.map(type=><button key={type.id} type="button" className="secondary" onClick={()=>setRepairTypeText(type.name)}>{type.name}</button>)}
            </div>
          ) : !repairTypeText.trim() && quickPicks.length ? (
            <div className="shop-note-chips" aria-label="Common repair types">
              {quickPicks.map(type=><button key={type.id} type="button" className="secondary" onClick={()=>setRepairTypeText(type.name)}>{type.name}</button>)}
            </div>
          ) : null}
          <div className="shop-reading">
            <div><b>Odometer</b>{motive ? <i className="shop-motive-badge">MOTIVE</i> : null}</div>
            {motive ? (
              <p className="shop-hint">{formatRepairReading(motive.value, motive.unit)}{motive.locatedAt ? ` · as of ${new Date(motive.locatedAt).toLocaleString()}` : ''}. The repair is filed at Motive’s latest reading.</p>
            ) : (
              <>
                <p className="shop-hint">No Motive reading for this unit. Enter the reading and why it’s manual; manual readings are recorded in the audit log.</p>
                <div>
                  <input aria-label="Manual reading" inputMode="decimal" value={manualValue} onChange={event=>setManualValue(event.target.value)} placeholder="Reading"/>
                  <select aria-label="Reading unit" value={manualUnit} onChange={event=>setManualUnit(event.target.value as 'miles'|'hrs')}>
                    <option value="miles">Miles</option>
                    <option value="hrs">Engine hours</option>
                  </select>
                </div>
                <label>Reason for manual reading<input value={manualReason} maxLength={500} onChange={event=>setManualReason(event.target.value)} placeholder="No telematics on this unit"/></label>
              </>
            )}
          </div>
          <label>Labor hours<input inputMode="decimal" value={laborHours} onChange={event=>setLaborHours(event.target.value)} placeholder="Optional"/></label>
          <label>Notes / parts used<textarea value={notes} maxLength={4000} rows={3} onChange={event=>setNotes(event.target.value)}/></label>
          <label className="shop-check"><input type="checkbox" checked={openJob} onChange={event=>setOpenJob(event.target.checked)}/> Open a follow-up shop task</label>
          {problem || error ? <p className="receipt-error" role="alert">{problem || error}</p> : null}
        </div>
        <footer className="shop-new-job-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={busy} onClick={submit}><Wrench/> {busy ? 'Filing…' : 'File repair'}</button>
        </footer>
      </section>
    </div>
  );
}
