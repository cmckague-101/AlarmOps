import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarDays, Check, ChevronRight, CircleAlert, Clock3, ExternalLink, GraduationCap, MapPin, Pencil, Plus, Trash2, UserRound, Users, X } from 'lucide-react';
import { useDialogA11y } from './useDialogA11y';
import {isCompanyManager,isTrainingUnread,trainingStage,type FireOpsUser as TrainingUser,type Training,type TrainingSignup} from '@fireops/domain';
export {isTrainingUnread,trainingStage} from '@fireops/domain';
export type {Training,TrainingSignup,TrainingStage} from '@fireops/domain';

type Props={
  trainings:Training[];user:TrainingUser;error?:string;
  onCreate:(training:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>Promise<Training>;
  onEdit:(trainingId:string,values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>Promise<Training>;
  onDelete:(training:Training)=>Promise<void>;
  onSignup:(training:Training)=>Promise<TrainingSignup>;
  onCancelSignup:(training:Training)=>Promise<void>;
  onViewed:(training:Training)=>void;
};

const trainingDate=(value:string,options?:Intl.DateTimeFormatOptions)=>new Date(value).toLocaleString('en-US',options??{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});

export default function TrainingPage({trainings,user,error,onCreate,onEdit,onDelete,onSignup,onCancelSignup,onViewed}:Props){
  const [formOpen,setFormOpen]=useState(false);
  const [editing,setEditing]=useState<Training>();
  const [deleting,setDeleting]=useState<Training>();
  const [selected,setSelected]=useState<Training>();
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const nextMidnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);const timer=window.setTimeout(()=>setNow(new Date()),nextMidnight.getTime()-now.getTime()+50);return()=>window.clearTimeout(timer)},[now]);
  const visible=trainings.filter(training=>trainingStage(training,now)!=='removed');
  const scheduled=visible.filter(training=>trainingStage(training,now)==='scheduled').sort((left,right)=>Date.parse(left.date)-Date.parse(right.date));
  const expired=visible.filter(training=>trainingStage(training,now)==='expired').sort((left,right)=>Date.parse(right.date)-Date.parse(left.date));
  const openTraining=(training:Training)=>{setSelected(training);onViewed(training)};
  const currentSelected=selected?(trainings.find(item=>item.id===selected.id)??selected):undefined;
  const currentEditing=editing?(trainings.find(item=>item.id===editing.id)??editing):undefined;
  return <div className="page training-page"><div className="page-heading training-heading hero-heading"><div><h1>Training</h1><p>Upcoming courses and crew registration.</p><a className="training-portal-link" href="https://www.wildlandfirelearningportal.net/login/index.php" target="_blank" rel="noreferrer">Wildland Training Portal <ExternalLink/></a></div>{isCompanyManager(user.role)&&<button className="primary" onClick={()=>setFormOpen(true)}><Plus/> New training</button>}</div>
    {error&&<div className="communication-load-error" role="alert"><CircleAlert/><span>{error}</span></div>}
    <section className="training-panel" aria-labelledby="training-list-heading"><header><div><h2 id="training-list-heading">Scheduled courses</h2><p>{scheduled.length} {scheduled.length===1?'course':'courses'}</p></div></header><div className="training-list">{scheduled.map(training=><TrainingListRow key={training.id} training={training} user={user} onClick={()=>openTraining(training)}/>)}{!scheduled.length&&<div className="empty training-empty"><GraduationCap/><h3>No training scheduled</h3><p>{isCompanyManager(user.role)?'Create first course and notify crew.':'New courses will appear here when company manager schedules them.'}</p></div>}</div></section>
    {expired.length>0&&<section className="training-panel expired-training-panel" aria-labelledby="expired-training-heading"><header><div><h2 id="expired-training-heading">Expired</h2><p>Courses remain here for one month</p></div></header><div className="training-list">{expired.map(training=><TrainingListRow key={training.id} training={training} user={user} expired onClick={()=>openTraining(training)}/>)}</div></section>}
    {formOpen&&!currentEditing&&<TrainingForm onClose={()=>setFormOpen(false)} onSave={async values=>{await onCreate(values);setFormOpen(false)}}/>}
    {currentEditing&&<TrainingForm training={currentEditing} onClose={()=>{setEditing(undefined);setFormOpen(false)}} onSave={async values=>{await onEdit(currentEditing.id,values);setEditing(undefined);setFormOpen(false)}}/>}
    {currentSelected&&<TrainingDetail training={currentSelected} user={user} expired={trainingStage(currentSelected,now)==='expired'} onClose={()=>setSelected(undefined)} onSignup={onSignup} onCancelSignup={onCancelSignup} onEdit={training=>{setEditing(training);setSelected(undefined)}} onDelete={training=>{setDeleting(training);setSelected(undefined)}}/>}
    {deleting&&<DeleteTrainingDialog training={deleting} onCancel={()=>setDeleting(undefined)} onConfirm={async()=>{await onDelete(deleting);setDeleting(undefined)}}/>}
  </div>;
}

function TrainingListRow({training,user,expired=false,onClick}:{training:Training;user:TrainingUser;expired?:boolean;onClick:()=>void}){
  const signedUp=training.signups.some(signup=>signup.userId===user.id);
  const full=training.signups.length>=training.capacity;
  const unread=!expired&&isTrainingUnread(training,user);
  const fill=Math.min(100,Math.round(training.signups.length/training.capacity*100));
  return <button className={`training-row ${unread?'unread':''} ${expired?'expired':''}`} onClick={onClick}><span className="training-date"><b>{new Date(training.date).toLocaleDateString('en-US',{day:'2-digit'})}</b><small>{new Date(training.date).toLocaleDateString('en-US',{month:'short'})}</small></span><span className="training-copy"><span className="training-title"><b>{training.courseTitle}</b>{unread&&<i>New</i>}{expired?<em className="expired-label">Expired</em>:signedUp&&<em><Check/> Registered</em>}</span><small>{training.courseCode} · {training.instructor}</small><span className="training-meta"><span><Clock3/>{trainingDate(training.date,{hour:'numeric',minute:'2-digit'})}</span><span><MapPin/>{training.location}</span></span></span><span className="training-capacity"><span><b>{training.signups.length}</b> / {training.capacity}</span><small>{full?'Course full':'registered'}</small><i aria-hidden="true"><span style={{width:`${fill}%`}}/></i></span><ChevronRight/></button>;
}

function TrainingForm({training,onClose,onSave}:{training?:Training;onClose:()=>void;onSave:(values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>Promise<void>}){
  const [form,setForm]=useState(()=>{const base=training?new Date(training.date):null;return {courseCode:training?.courseCode??'',courseTitle:training?.courseTitle??'',date:base?(new Date(base.getTime()-base.getTimezoneOffset()*60000).toISOString().slice(0,16)):'',location:training?.location??'',instructor:training?.instructor??'',capacity:training?String(training.capacity):'',information:training?.information??''}});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [submitError,setSubmitError]=useState('');
  const [busy,setBusy]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  const dialog=useDialogA11y(()=>{if(!busy)onClose()});
  const update=(key:string,value:string)=>setForm(current=>({...current,[key]:value}));
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const next:Record<string,string>={};
    if(!form.courseCode.trim())next.courseCode='Course code is required';
    if(!form.courseTitle.trim())next.courseTitle='Course title is required';
    // Editing a course that already started keeps its date valid; only a new or changed date must be in the future.
    const dateChanged=!training||Math.floor(Date.parse(form.date)/60000)!==Math.floor(Date.parse(training.date)/60000);
    if(!form.date||(dateChanged&&Date.parse(form.date)<=Date.now()))next.date='Choose a future date and time';
    if(!form.location.trim())next.location='Location is required';
    if(!form.instructor.trim())next.instructor='Instructor is required';
    if(!Number.isInteger(Number(form.capacity))||Number(form.capacity)<1||Number(form.capacity)>10000)next.capacity='Capacity must be between 1 and 10,000';
    else if(training&&Number(form.capacity)<training.signups.length)next.capacity=`Capacity can't be lower than the ${training.signups.length} crew members already registered`;
    setErrors(next);setSubmitError('');
    if(Object.keys(next).length){formRef.current?.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus();return}
    setBusy(true);
    try{await onSave({courseCode:form.courseCode.trim(),courseTitle:form.courseTitle.trim(),date:new Date(form.date).toISOString(),location:form.location.trim(),instructor:form.instructor.trim(),capacity:Number(form.capacity),information:form.information.trim()})}
    catch(error){setSubmitError(error instanceof Error?error.message:`Training could not be ${training?'updated':'created'}. Check connection and try again.`);setBusy(false)}
  };
  const field=(name:keyof typeof form,label:string,required=true,type='text')=><label className={errors[name]?'has-error':''}><span>{label}{required&&<b> *</b>}</span><input name={name} type={type} value={form[name]} disabled={busy} onChange={event=>update(name,event.target.value)} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name]?`${name}-error`:undefined}/>{errors[name]&&<small id={`${name}-error`}>{errors[name]}</small>}</label>;
  return createPortal(<div className="overlay"><section ref={dialog.ref} className="drawer form-drawer training-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-busy={busy} tabIndex={-1}><header><button className="back-mobile" disabled={busy} onClick={onClose}><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{training?'Edit training':'Create training'}</h2><p>Course details notify every crew member.</p></div><button className="close" disabled={busy} onClick={onClose} aria-label="Close training form"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><fieldset><div className="form-grid">{field('courseCode','Course code')}{field('courseTitle','Course title')}{field('date','Date and time',true,'datetime-local')}{field('location','Location')}{field('instructor','Instructor')}{field('capacity','Capacity',true,'number')}<label className="wide"><span>Course information</span><textarea name="information" maxLength={5000} value={form.information} disabled={busy} onChange={event=>update('information',event.target.value)} placeholder="Prerequisites, required gear, arrival instructions, or course outline"/></label></div>{submitError&&<div className="form-submit-error" role="alert">{submitError}</div>}</fieldset><footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy?(training?'Saving...':'Creating...'):training?'Save changes':'Create training'}</button></footer></form></section></div>,document.body);
}

function TrainingDetail({training,user,expired,onClose,onSignup,onCancelSignup,onEdit,onDelete}:{training:Training;user:TrainingUser;expired:boolean;onClose:()=>void;onSignup:Props['onSignup'];onCancelSignup:Props['onCancelSignup'];onEdit:(training:Training)=>void;onDelete:(training:Training)=>void}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dialog=useDialogA11y(()=>{if(!busy)onClose()});
  const signedUp=training.signups.some(signup=>signup.userId===user.id);
  const full=training.signups.length>=training.capacity;
  const toggle=async()=>{setBusy(true);setError('');try{if(signedUp)await onCancelSignup(training);else await onSignup(training)}catch(actionError){setError(actionError instanceof Error?actionError.message:'Registration could not be changed. Try again.')}finally{setBusy(false)}};
  return createPortal(<div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer training-detail" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" disabled={busy} onClick={onClose}><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{training.courseTitle}</h2><p>{training.courseCode}</p></div><button className="close" disabled={busy} onClick={onClose} aria-label="Close training details"><X/></button></header><div className="training-detail-hero"><span><GraduationCap/></span><div><small>{training.courseCode}</small><h3>{training.courseTitle}</h3><p>{training.signups.length} of {training.capacity} registered</p></div></div><div className="detail-section"><h4>Course details</h4><dl className="details"><DetailRow icon={<CalendarDays/>} label="Date" value={trainingDate(training.date)}/><DetailRow icon={<MapPin/>} label="Location" value={training.location}/><DetailRow icon={<UserRound/>} label="Instructor" value={training.instructor}/><DetailRow icon={<Users/>} label="Capacity" value={`${training.signups.length} / ${training.capacity}`}/></dl></div>{training.information&&<div className="detail-section"><h4>Course information</h4><p className="training-information">{training.information}</p></div>}{!isCompanyManager(user.role)&&!expired&&<div className="training-registration"><button className={signedUp?'secondary':'primary'} disabled={busy||(!signedUp&&full)} onClick={()=>void toggle()}>{busy?'Saving...':signedUp?'Cancel registration':full?'Course full':'Sign up for training'}</button>{signedUp&&<p><Check/> You are registered for this course.</p>}{error&&<div className="form-submit-error" role="alert">{error}</div>}</div>}{!isCompanyManager(user.role)&&expired&&<div className="training-registration training-ended"><p>Course ended. Registration is closed.</p></div>}{isCompanyManager(user.role)&&<div className="detail-section training-roster"><h4>Signed up <span>{training.signups.length}</span></h4>{training.signups.length?<div>{[...training.signups].sort((a,b)=>a.userName.localeCompare(b.userName)).map(signup=><article key={signup.userId}><span>{signup.userName.slice(0,1).toUpperCase()}</span><div><b>{signup.userName}</b><small>Registered {trainingDate(signup.signedUpAt)}</small></div></article>)}</div>:<p className="no-updates">No crew members have signed up.</p>}</div>}{isCompanyManager(user.role)&&<div className="training-owner-actions"><button className="secondary" onClick={()=>onEdit(training)}><Pencil/> Edit training</button><button className="danger-button" onClick={()=>onDelete(training)}><Trash2/> Delete training</button></div>}</section></div>,document.body);
}

function DetailRow({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div><dt>{icon}<span>{label}</span></dt><dd>{value}</dd></div>}

function DeleteTrainingDialog({training,onCancel,onConfirm}:{training:Training;onCancel:()=>void;onConfirm:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dialog=useDialogA11y(()=>{if(!busy)onCancel()});
  const remove=async()=>{setBusy(true);setError('');try{await onConfirm()}catch(deleteError){setError(deleteError instanceof Error?deleteError.message:'Training could not be deleted. Check your connection and try again.');setBusy(false)}};
  return createPortal(<div className="overlay confirm-overlay"><section ref={dialog.ref} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-describedby={`${dialog.titleId}-description`} aria-busy={busy} tabIndex={-1}><span className="confirm-icon"><Trash2/></span><div><h2 id={dialog.titleId}>Delete {training.courseTitle}?</h2><p id={`${dialog.titleId}-description`}>This cancels the course for every crew member and removes all registrations. This action cannot be undone.</p>{error&&<div className="confirm-error" role="alert">{error}</div>}</div><footer><button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="danger-button" disabled={busy} onClick={()=>void remove()}><Trash2/> {busy?'Deleting...':'Delete training'}</button></footer></section></div>,document.body);
}
