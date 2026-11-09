import {describe, expect, it} from 'vitest';
import {loadDemoMotiveConnection, motiveSnapshotFor, navigationLayout, sidebarSplit} from './App';
import {
  canInspectVehicle,canOpenVehicleIssue,canProcessFinance,dashboardNotifications,isDocumentUnread,isThreadUnread,isTrainingUnread,trainingStage,visibleVehicleIssues,
  type CommunicationThread,type CompanyDocument,type FireOpsUser,type FleetIssue,type FleetSnapshot,type Training,type VehicleFile,
} from '@fireops/domain';
import {accountAccessErrorMessage, fleetRecordsEqual, snapshotFilePaths, stripSignedFileUrls} from './FleetApp';
import {demoRequested, mayHaveSession} from './FleetRoot';

describe('mobile demo entry',()=>{
  it('opens demo only with explicit demo flag',()=>{
    expect(demoRequested('?demo=1')).toBe(true);
    expect(demoRequested('?info=1&demo=1')).toBe(true);
    expect(demoRequested('')).toBe(false);
    expect(demoRequested('?demo=0')).toBe(false);
    expect(demoRequested('?demo=true')).toBe(false);
  });
});

describe('demo Motive telemetry',()=>{
  it('starts connected with simulated data without reading saved integration settings',()=>{
    expect(loadDemoMotiveConnection(true)).toEqual({connected:true,configured:true,mock:true});
  });

  it('provides distinct map locations and detail telemetry for all three demo vehicles',()=>{
    const connection=loadDemoMotiveConnection(true);
    const feeds=['v1','v2','v3'].map((id,index)=>motiveSnapshotFor({
      ...snapshot().vehicles[0],id,status:index===2?'Out of service':'Ready',
    },connection)!);
    expect(new Set(feeds.map(feed=>`${feed.latitude},${feed.longitude}`)).size).toBe(3);
    for(const feed of feeds){
      expect(Number.isFinite(feed.latitude)).toBe(true);
      expect(Number.isFinite(feed.longitude)).toBe(true);
      expect(feed.location).toContain('CA');
      expect(feed.speed).toContain('mph');
      expect(feed.updatedAt).toContain('Updated');
    }
    expect(feeds[0].diagnostics).toEqual([]);
    expect(feeds[2].diagnostics).toEqual([expect.objectContaining({code:'P0117',status:'open'})]);
  });

  it('never substitutes simulated data for an unmatched live vehicle',()=>{
    expect(motiveSnapshotFor(snapshot().vehicles[0],{connected:true,vehicles:[]})).toBeUndefined();
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
  it('shows roster to all roles and reserves inspections and audit logs for managers',()=>{
    expect(navigationLayout('owner').desktop).toEqual(['overview','operations','dispatch','hotels','communications','vehicles','shop','crew','qualifications','documents','receipts','invoices','payroll','availability','training','audit-log','settings']);
    expect(navigationLayout('admin').desktop).toEqual(navigationLayout('owner').desktop);
    expect(navigationLayout('fire_fighter').desktop).toEqual(['overview','operations','dispatch','hotels','communications','vehicles','crew','qualifications','documents','receipts','invoices','payroll','availability','training','settings']);
  });

  it('moves Inventory and Failed Inspections into More, except Inventory for Resource Bosses and shop techs',()=>{
    for(const role of ['owner','admin','fire_fighter','accounting'] as const){
      expect(navigationLayout(role).desktop).not.toContain('inventory');
      expect(navigationLayout(role).mobileOverflow).toContain('inventory');
    }
    expect(navigationLayout('owner').desktop).not.toContain('inspections');
    expect(navigationLayout('owner').mobileOverflow).toContain('inspections');
    expect(navigationLayout('resource_boss').desktop).toContain('inventory');
    expect(navigationLayout('shop_tech').desktop).toContain('inventory');
    expect(navigationLayout('shop_tech').desktop).not.toContain('inspections');
  });

  it('shows Shop to owners, admins and shop techs only',()=>{
    expect(navigationLayout('shop_tech').desktop).toContain('shop');
    expect(navigationLayout('accounting').desktop).not.toContain('shop');
    expect(navigationLayout('fire_fighter').desktop).not.toContain('shop');
  });

  it('moves only footer overflow into More on mobile',()=>{
    expect(navigationLayout('owner').mobilePrimary).toEqual(['overview','operations','vehicles','communications']);
    expect(navigationLayout('owner').mobileOverflow).toEqual(['dispatch','hotels','shop','crew','qualifications','documents','receipts','invoices','payroll','availability','training','inventory','inspections','audit-log','settings']);
    expect(navigationLayout('fire_fighter').mobileOverflow).toEqual(['dispatch','hotels','crew','qualifications','documents','receipts','invoices','payroll','availability','training','inventory','settings']);
  });
});

describe('desktop sidebar overflow',()=>{
  it('shows everything when the window is tall enough and More lists only the More-only pages',()=>{
    const split=sidebarSplit('owner',Number.POSITIVE_INFINITY);
    expect(split.shown).toEqual(navigationLayout('owner').desktop.filter(page=>page!=='settings'));
    expect(split.overflow).toEqual([]);
    expect(split.more).toEqual(['inventory','inspections']);
  });
  it('moves rows that do not fit into More, keeping More and Settings at the bottom',()=>{
    const split=sidebarSplit('owner',8);
    expect(split.shown).toEqual(['overview','operations','dispatch','hotels','communications','vehicles']);
    expect(split.settings).toBe(true);
    expect(split.more).toEqual(['shop','crew','qualifications','documents','receipts','invoices','payroll','availability','training','audit-log','inventory','inspections']);
    // Nothing is lost: every page is either in the sidebar or in More.
    expect(new Set([...split.shown,...split.more,'settings'])).toEqual(new Set(navigationLayout('owner').mobileOverflow.concat(navigationLayout('owner').mobilePrimary)));
  });
  it('keeps Inventory in the sidebar for shop techs when it fits, and always shows at least one row',()=>{
    expect(sidebarSplit('shop_tech',Number.POSITIVE_INFINITY).more).toEqual([]);
    expect(sidebarSplit('shop_tech',Number.POSITIVE_INFINITY).shown).toContain('inventory');
    expect(sidebarSplit('fire_fighter',1).shown).toEqual(['overview']);
  });
});

describe('vehicle action permissions',()=>{
  it.each(['fire_fighter','accounting'] as const)('prevents %s from opening issues or inspecting vehicles',role=>{
    expect(canOpenVehicleIssue(role)).toBe(false);
    expect(canInspectVehicle(role)).toBe(false);
  });

  it.each(['owner','admin','shop_tech'] as const)('allows %s to open issues and inspect vehicles',role=>{
    expect(canOpenVehicleIssue(role)).toBe(true);
    expect(canInspectVehicle(role)).toBe(true);
  });
});

describe('payroll and invoice processing',()=>{
  it.each([['owner',true],['accounting',true],['admin',false],['shop_tech',false],['fire_fighter',false]] as const)('%s can process finance: %s',(role,allowed)=>{
    expect(canProcessFinance(role)).toBe(allowed);
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

describe('mayHaveSession', () => {
  const storage=(keys:string[])=>({length:keys.length,key:(index:number)=>keys[index]??null});
  it('skips the session check for signed-out visitors', () => {
    expect(mayHaveSession(storage(['theme']),{search:'',hash:'#pricing'})).toBe(false);
  });
  it('checks when a Supabase token is stored or an auth callback is in the URL', () => {
    expect(mayHaveSession(storage(['sb-abc-auth-token']),{search:'',hash:''})).toBe(true);
    expect(mayHaveSession(storage([]),{search:'?code=123',hash:''})).toBe(true);
    expect(mayHaveSession(storage([]),{search:'',hash:'#access_token=x&type=magiclink'})).toBe(true);
    expect(mayHaveSession(null,{search:'',hash:''})).toBe(true);
  });
});
