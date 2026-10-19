import {describe, expect, it} from 'vitest';
import {navigationLayout} from './App';
import {
  canInspectVehicle,canOpenVehicleIssue,dashboardNotifications,isDocumentUnread,isThreadUnread,isTrainingUnread,trainingStage,visibleVehicleIssues,
  type CommunicationThread,type CompanyDocument,type FireOpsUser,type FleetIssue,type FleetSnapshot,type Training,type VehicleFile,
} from '@fireops/domain';
import {accountAccessErrorMessage, demoRequested, fleetRecordsEqual, snapshotFilePaths, stripSignedFileUrls} from './FleetApp';

describe('mobile demo entry',()=>{
  it('opens demo only with explicit demo flag',()=>{
    expect(demoRequested('?demo=1')).toBe(true);
    expect(demoRequested('?info=1&demo=1')).toBe(true);
    expect(demoRequested('')).toBe(false);
    expect(demoRequested('?demo=0')).toBe(false);
    expect(demoRequested('?demo=true')).toBe(false);
  });
});

const storedFile = (path:string):VehicleFile => ({name:'document.pdf',type:'application/pdf',dataUrl:'https://signed.example/file',path});

function snapshot():FleetSnapshot {
  return {
    vehicles:[{
      id:'11111111-1111-4111-8111-111111111111',unit:'Engine 1',type:'Type 3 Engine',year:2024,
      make:'International',model:'HV',vin:'',plate:'',status:'Ready',createdAt:'2025-01-01',
      photo:storedFile('company/user/photo.webp'),insurance:storedFile('company/user/insurance.pdf'),
      documents:[{id:'registration',name:'Registration',file:storedFile('company/user/registration.pdf')},{id:'vipr',name:'VIPR checklist',file:storedFile('company/user/vipr.pdf')}],
    }],
    issues:[],
    crew:[{id:'22222222-2222-4222-8222-222222222222',name:'Crew Member',email:'crew@example.com',phone:'',role:'fire_fighter',status:'Active',credential:storedFile('company/owner/credential.pdf'),credentials:[{id:'red-card',name:'Red Card',file:storedFile('company/owner/red-card.pdf')},{id:'emt',name:'EMT',file:storedFile('company/owner/emt.jpg')}]}],
    activities:[],
  };
}

describe('responsive navigation',()=>{
  it('shows roster to all roles and reserves inspections for managers',()=>{
    expect(navigationLayout('owner').desktop).toEqual(['overview','operations','dispatch','communications','vehicles','crew','qualifications','documents','receipts','invoices','payroll','availability','training','inventory','inspections','settings']);
    expect(navigationLayout('admin').desktop).toEqual(navigationLayout('owner').desktop);
    expect(navigationLayout('fire_fighter').desktop).toEqual(['overview','operations','dispatch','communications','vehicles','crew','qualifications','documents','receipts','invoices','payroll','availability','training','inventory','settings']);
  });

  it('moves only footer overflow into More on mobile',()=>{
    expect(navigationLayout('owner').mobilePrimary).toEqual(['overview','operations','vehicles','communications']);
    expect(navigationLayout('owner').mobileOverflow).toEqual(['dispatch','crew','qualifications','documents','receipts','invoices','payroll','availability','training','inventory','inspections','settings']);
    expect(navigationLayout('fire_fighter').mobileOverflow).toEqual(['dispatch','crew','qualifications','documents','receipts','invoices','payroll','availability','training','inventory','settings']);
  });
});

describe('vehicle action permissions',()=>{
  it('prevents fire fighters from opening issues or inspecting vehicles',()=>{
    expect(canOpenVehicleIssue('fire_fighter')).toBe(false);
    expect(canInspectVehicle('fire_fighter')).toBe(false);
  });

  it.each(['owner','admin','shop_tech'] as const)('allows %s to open issues and inspect vehicles',role=>{
    expect(canOpenVehicleIssue(role)).toBe(true);
    expect(canInspectVehicle(role)).toBe(true);
  });
});

describe('vehicle issue visibility',()=>{
  const issues:FleetIssue[]=[
    {id:'open-other',vehicleId:'vehicle-1',title:'Open issue',description:'Needs repair',priority:'High',status:'Open',updates:[],createdBy:'Other Crew',createdById:'crew-2',createdAt:'2025-08-30T10:00:00Z'},
    {id:'resolved-other',vehicleId:'vehicle-1',title:'Resolved issue',description:'Repaired',priority:'Low',status:'Resolved',resolvedAt:'2025-08-30T12:00:00Z',updates:[],createdBy:'Other Crew',createdById:'crew-2',createdAt:'2025-08-29T10:00:00Z'},
  ];

  it('shows every open issue to crew, regardless of reporter',()=>{
    const crew:FireOpsUser={id:'crew-1',name:'Crew Member',role:'fire_fighter'};
    expect(visibleVehicleIssues(issues,crew).map(issue=>issue.id)).toEqual(['open-other']);
  });

  it('shows open and resolved issue history to owners',()=>{
    const owner:FireOpsUser={id:'owner-1',name:'Owner',role:'owner'};
    expect(visibleVehicleIssues(issues,owner)).toEqual(issues);
    expect(visibleVehicleIssues(issues,{...owner,role:'admin'})).toEqual(issues);
  });
});

describe('account access errors',()=>{
  it('reserves migration guidance for a missing database function',()=>{
    expect(accountAccessErrorMessage({code:'PGRST202'},null)).toContain('database migrations');
  });

  it('gives recoverable guidance for transient request failures',()=>{
    expect(accountAccessErrorMessage({message:'Failed to fetch'},{code:'503'})).toBe(
      'Account access could not be verified. Check your connection and try again.'
    );
  });
});

describe('fleet record comparison',()=>{
  it('ignores JSONB object key ordering and properties omitted by JSON transport',()=>{
    expect(fleetRecordsEqual(
      {id:'vehicle-1',unit:'Engine 1',assignedFire:{name:'Mesa',id:'fire-1'},photo:undefined},
      {unit:'Engine 1',assignedFire:{id:'fire-1',name:'Mesa'},id:'vehicle-1'}
    )).toBe(true);
  });

  it('detects persisted value changes',()=>{
    expect(fleetRecordsEqual({id:'vehicle-1',status:'Ready'},{status:'Assigned',id:'vehicle-1'})).toBe(false);
  });
});

describe('communication unread rules',()=>{
  const user:FireOpsUser={id:'22222222-2222-4222-8222-222222222222',name:'Crew Member',role:'fire_fighter'};
  const thread=(overrides:Partial<CommunicationThread>={}):CommunicationThread=>({
    id:'thread-1',subject:'Dispatch update',description:'Meet at staging.',createdBy:'Company Owner',createdById:'11111111-1111-4111-8111-111111111111',createdByRole:'owner',createdAt:'2025-08-28T10:00:00Z',replies:[],...overrides
  });

  it('notifies crew about unseen owner threads',()=>{
    expect(isThreadUnread(thread(),user)).toBe(true);
    expect(isThreadUnread(thread({seenAt:'2025-08-28T10:01:00Z'}),user)).toBe(false);
  });

  it('does not notify all crew about a crew-created thread',()=>{
    expect(isThreadUnread(thread({createdByRole:'fire_fighter'}),user)).toBe(false);
  });

  it('notifies owner about every new thread, but not unrelated replies',()=>{
    const owner:FireOpsUser={id:'11111111-1111-4111-8111-111111111111',name:'Company Owner',role:'owner'};
    const crewThread=thread({createdBy:'Crew Member',createdById:user.id,createdByRole:'fire_fighter'});
    expect(isThreadUnread(crewThread,owner)).toBe(true);
    expect(isThreadUnread({...crewThread,seenAt:'2025-08-28T10:01:00Z',replies:[{id:'reply-1',body:'Copy.',createdBy:'Other Crew',createdById:'33333333-3333-4333-8333-333333333333',createdAt:'2025-08-28T10:05:00Z'}]},owner)).toBe(false);
  });

  it('notifies thread creators and participants about new replies',()=>{
    const reply={id:'reply-1',body:'Copy.',createdBy:'Other Crew',createdById:'33333333-3333-4333-8333-333333333333',createdAt:'2025-08-28T10:05:00Z'};
    expect(isThreadUnread(thread({createdById:user.id,createdByRole:'fire_fighter',seenAt:'2025-08-28T10:01:00Z',replies:[reply]}),user)).toBe(true);
    expect(isThreadUnread(thread({createdByRole:'fire_fighter',seenAt:'2025-08-28T10:01:00Z',replies:[{...reply,createdById:user.id,createdAt:'2025-08-28T10:02:00Z'},reply]}),user)).toBe(true);
  });
});

describe('dashboard notifications',()=>{
  const crew:FireOpsUser={id:'crew-1',name:'Crew Member',role:'fire_fighter'};
  const thread=(id:string,createdAt:string):CommunicationThread=>({id,subject:`Dispatch ${id}`,description:'Report to staging.',createdBy:'Company Owner',createdById:'owner-1',createdByRole:'owner',createdAt,replies:[]});
  const document=(id:string,updatedAt:string):CompanyDocument=>({id,name:`Document ${id}`,file:storedFile(`company/owner/${id}.pdf`),createdAt:updatedAt,updatedAt});

  it('shows Crew Chat notifications and excludes documents',()=>{
    const notifications=dashboardNotifications(
      [thread('thread-1','2025-08-30T10:00:00Z')],
      [document('document-1','2025-08-30T11:00:00Z')],
      crew
    );
    expect(notifications.map(item=>item.source)).toEqual(['communications']);
    expect(notifications.every(item=>item.unread)).toBe(true);
  });

  it('limits member dashboard notifications to latest 5 and hides section data from owners',()=>{
    const threads=Array.from({length:12},(_,index)=>thread(`thread-${index}`,`2025-08-30T${String(index).padStart(2,'0')}:00:00Z`));
    expect(dashboardNotifications(threads,[],crew).map(item=>item.id)).toEqual([
      'communication-thread-11','communication-thread-10','communication-thread-9','communication-thread-8','communication-thread-7',
    ]);
    expect(dashboardNotifications(threads,[],{...crew,role:'owner'})).toEqual([]);
  });
});

describe('training unread rules',()=>{
  const training:Training={id:'training-1',courseCode:'S-130',courseTitle:'Firefighter Training',date:'2025-09-10T16:00:00Z',location:'Station 1',instructor:'Alex Reed',capacity:20,information:'',createdAt:'2025-08-30T10:00:00Z',updatedAt:'2025-08-30T10:00:00Z',signups:[]};

  it('notifies crew until training is opened',()=>{
    const crew:FireOpsUser={id:'crew-1',name:'Crew Member',role:'fire_fighter'};
    expect(isTrainingUnread(training,crew)).toBe(true);
    expect(isTrainingUnread({...training,viewedAt:'2025-08-30T10:01:00Z'},crew)).toBe(false);
    expect(isTrainingUnread(training,{...crew,role:'owner'})).toBe(false);
  });

  it('moves courses to expired next day and removes them one month later',()=>{
    const dated={...training,date:new Date(2025,8,10,16).toISOString()};
    expect(trainingStage(dated,new Date(2025,8,10,23,59))).toBe('scheduled');
    expect(trainingStage(dated,new Date(2025,8,11))).toBe('expired');
    expect(trainingStage(dated,new Date(2025,9,10,23,59))).toBe('expired');
    expect(trainingStage(dated,new Date(2025,9,11))).toBe('removed');
  });
});

describe('document unread rules',()=>{
  const document:CompanyDocument={id:'document-1',name:'Employee handbook',file:storedFile('company/owner/handbook.pdf'),createdAt:'2025-08-30T10:00:00Z',updatedAt:'2025-08-30T10:00:00Z'};

  it('notifies crew until latest document version is viewed',()=>{
    const crew:FireOpsUser={id:'crew-1',name:'Crew Member',role:'fire_fighter'};
    expect(isDocumentUnread(document,crew)).toBe(true);
    expect(isDocumentUnread({...document,viewedAt:'2025-08-30T10:01:00Z'},crew)).toBe(false);
    expect(isDocumentUnread({...document,updatedAt:'2025-08-30T10:02:00Z',viewedAt:'2025-08-30T10:01:00Z'},crew)).toBe(true);
  });

  it('does not notify owners',()=>{
    expect(isDocumentUnread(document,{id:'owner-1',name:'Owner',role:'owner'})).toBe(false);
  });
});

describe('fleet file persistence',()=>{
  it('removes expiring signed URLs without mutating UI state',()=>{
    const current=snapshot();
    const persisted=stripSignedFileUrls(current);

    expect(persisted.vehicles[0].photo?.dataUrl).toBe('');
    expect(persisted.vehicles[0].insurance?.dataUrl).toBe('');
    expect(persisted.vehicles[0].documents?.every(document=>document.file.dataUrl==='')).toBe(true);
    expect(persisted.crew[0].credential?.dataUrl).toBe('');
    expect(persisted.crew[0].credentials?.every(credential=>credential.file?.dataUrl==='')).toBe(true);
    expect(current.vehicles[0].photo?.dataUrl).toContain('signed.example');
    expect(current.crew[0].credentials?.[0].file?.dataUrl).toContain('signed.example');
  });

  it('collects every referenced storage path for orphan cleanup',()=>{
    expect([...snapshotFilePaths(snapshot())].sort()).toEqual([
      'company/owner/credential.pdf',
      'company/owner/emt.jpg',
      'company/owner/red-card.pdf',
      'company/user/insurance.pdf',
      'company/user/photo.webp',
      'company/user/registration.pdf',
      'company/user/vipr.pdf',
    ]);
  });
});
