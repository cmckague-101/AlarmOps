import type {
  CommunicationThread, CompanyDocument, CrewCredential, CrewMember, DashboardNotification, FireOpsUser, FleetIssue,
  Training, TrainingStage, Vehicle,
} from './models';

export function normalizeVehicle(vehicle:Vehicle):Vehicle {
  const normalizedStatus=(vehicle.status as string)==='Maintenance'?'Out of service':vehicle.status;
  const normalized={...vehicle,status:normalizedStatus} as Vehicle;
  if(normalized.status==='Assigned')return normalized.assignedTo?normalized:{...normalized,status:'Ready',assignedFire:undefined};
  return normalized.assignedTo?{...normalized,assignedTo:undefined,assignedFire:undefined}:normalized;
}

export function normalizeVehicles(vehicles:Vehicle[]):Vehicle[]{
  return vehicles.map(normalizeVehicle);
}

export function visibleVehicleIssues(issues:FleetIssue[],user:FireOpsUser):FleetIssue[]{
  return user.role==='owner'?issues:issues.filter(issue=>issue.status==='Open');
}

export function crewCredentials(member:CrewMember):CrewCredential[]{
  if(member.credentials?.length)return member.credentials;
  if(!member.credential)return [];
  return [{id:`legacy-${member.credential.path??member.credential.name}`,name:member.credentialName?.trim()||member.credential.name,file:member.credential}];
}

export function credentialExpiresWithinMonth(credential:CrewCredential,now=new Date()):boolean{
  if(!credential.expirationDate)return false;
  const expiration=new Date(`${credential.expirationDate}T23:59:59`);
  if(Number.isNaN(expiration.getTime())||expiration<now)return false;
  const monthFromNow=new Date(now);
  monthFromNow.setMonth(monthFromNow.getMonth()+1);
  return expiration<=monthFromNow;
}

export function isThreadUnread(thread:CommunicationThread,user:FireOpsUser):boolean {
  const seenAt=thread.seenAt?Date.parse(thread.seenAt):0;
  const newThread=thread.createdById!==user.id&&Date.parse(thread.createdAt)>seenAt&&(user.role==='owner'||thread.createdByRole==='owner');
  const participates=thread.createdById===user.id||thread.replies.some(reply=>reply.createdById===user.id);
  const relevantReply=participates&&thread.replies.some(reply=>reply.createdById!==user.id&&Date.parse(reply.createdAt)>seenAt);
  return newThread||relevantReply;
}

export function isDocumentUnread(document:CompanyDocument,user:FireOpsUser):boolean {
  return user.role==='member'&&Date.parse(document.updatedAt)>Date.parse(document.viewedAt??'1970-01-01');
}

export function isTrainingUnread(training:Training,user:FireOpsUser):boolean {
  return user.role==='member'&&Date.parse(training.createdAt)>Date.parse(training.viewedAt??'1970-01-01');
}

export function trainingStage(training:Training,now=new Date()):TrainingStage {
  const courseDate=new Date(training.date);
  const expiresAt=new Date(courseDate.getFullYear(),courseDate.getMonth(),courseDate.getDate()+1);
  const removesAt=new Date(expiresAt);
  removesAt.setMonth(removesAt.getMonth()+1);
  return now<expiresAt?'scheduled':now<removesAt?'expired':'removed';
}

export function dashboardNotifications(
  threads:CommunicationThread[],documents:CompanyDocument[],user:FireOpsUser,limit=10,trainings:Training[]=[]
):DashboardNotification[]{
  if(user.role!=='member')return [];
  const communicationItems=threads.flatMap(thread=>{
    const participates=thread.createdById===user.id||thread.replies.some(reply=>reply.createdById===user.id);
    const candidates=[
      ...(thread.createdByRole==='owner'&&thread.createdById!==user.id?[{createdAt:thread.createdAt,detail:`New communication from ${thread.createdBy}`}]:[]),
      ...(participates?thread.replies.filter(reply=>reply.createdById!==user.id).map(reply=>({createdAt:reply.createdAt,detail:`${reply.createdBy} replied`})):[])
    ].sort((left,right)=>Date.parse(right.createdAt)-Date.parse(left.createdAt));
    const latest=candidates[0];
    return latest?[{id:`communication-${thread.id}`,source:'communications' as const,title:thread.subject,detail:latest.detail,createdAt:latest.createdAt,unread:isThreadUnread(thread,user)}]:[];
  });
  const documentItems=documents.map(document=>({id:`document-${document.id}`,source:'documents' as const,title:document.name,detail:'Company document added or updated',createdAt:document.updatedAt,unread:isDocumentUnread(document,user)}));
  const trainingItems=trainings.filter(training=>trainingStage(training)==='scheduled').map(training=>({id:`training-${training.id}`,source:'training' as const,title:training.courseTitle,detail:`${training.courseCode} · ${new Date(training.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`,createdAt:training.createdAt,unread:isTrainingUnread(training,user)}));
  return [...communicationItems,...documentItems,...trainingItems].sort((left,right)=>Date.parse(right.createdAt)-Date.parse(left.createdAt)).slice(0,Math.max(0,limit));
}
