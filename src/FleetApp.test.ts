import {describe, expect, it} from 'vitest';
import {dashboardNotifications, isDocumentUnread, isThreadUnread, navigationLayout, type CommunicationThread, type CompanyDocument, type FireOpsUser, type FleetSnapshot, type VehicleFile} from './App';
import {accountAccessErrorMessage, fleetRecordsEqual, snapshotFilePaths, stripSignedFileUrls} from './FleetApp';

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
    crew:[{id:'22222222-2222-4222-8222-222222222222',name:'Crew Member',email:'crew@example.com',phone:'',role:'member',status:'Active',credential:storedFile('company/owner/credential.pdf'),credentials:[{id:'red-card',name:'Red Card',file:storedFile('company/owner/red-card.pdf')},{id:'emt',name:'EMT',file:storedFile('company/owner/emt.jpg')}]}],
    activities:[],
  };
}

describe('responsive navigation',()=>{
  it('shows every owner section directly in desktop sidebar',()=>{
    expect(navigationLayout('owner').desktop).toEqual(['overview','operations','communications','vehicles','crew','documents','settings']);
  });

  it('moves only footer overflow into More on mobile',()=>{
    expect(navigationLayout('owner').mobilePrimary).toEqual(['overview','operations','vehicles','communications']);
    expect(navigationLayout('owner').mobileOverflow).toEqual(['crew','documents','settings']);
    expect(navigationLayout('member').mobileOverflow).toEqual(['documents','settings']);
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
  const user:FireOpsUser={id:'22222222-2222-4222-8222-222222222222',name:'Crew Member',role:'member'};
  const thread=(overrides:Partial<CommunicationThread>={}):CommunicationThread=>({
    id:'thread-1',subject:'Dispatch update',description:'Meet at staging.',createdBy:'Company Owner',createdById:'11111111-1111-4111-8111-111111111111',createdByRole:'owner',createdAt:'2025-08-28T10:00:00Z',replies:[],...overrides
  });

  it('notifies crew about unseen owner threads',()=>{
    expect(isThreadUnread(thread(),user)).toBe(true);
    expect(isThreadUnread(thread({seenAt:'2025-08-28T10:01:00Z'}),user)).toBe(false);
  });

  it('does not notify all crew about a crew-created thread',()=>{
    expect(isThreadUnread(thread({createdByRole:'member'}),user)).toBe(false);
  });

  it('notifies owner about every new thread, but not unrelated replies',()=>{
    const owner:FireOpsUser={id:'11111111-1111-4111-8111-111111111111',name:'Company Owner',role:'owner'};
    const crewThread=thread({createdBy:'Crew Member',createdById:user.id,createdByRole:'member'});
    expect(isThreadUnread(crewThread,owner)).toBe(true);
    expect(isThreadUnread({...crewThread,seenAt:'2025-08-28T10:01:00Z',replies:[{id:'reply-1',body:'Copy.',createdBy:'Other Crew',createdById:'33333333-3333-4333-8333-333333333333',createdAt:'2025-08-28T10:05:00Z'}]},owner)).toBe(false);
  });

  it('notifies thread creators and participants about new replies',()=>{
    const reply={id:'reply-1',body:'Copy.',createdBy:'Other Crew',createdById:'33333333-3333-4333-8333-333333333333',createdAt:'2025-08-28T10:05:00Z'};
    expect(isThreadUnread(thread({createdById:user.id,createdByRole:'member',seenAt:'2025-08-28T10:01:00Z',replies:[reply]}),user)).toBe(true);
    expect(isThreadUnread(thread({createdByRole:'member',seenAt:'2025-08-28T10:01:00Z',replies:[{...reply,createdById:user.id,createdAt:'2025-08-28T10:02:00Z'},reply]}),user)).toBe(true);
  });
});

describe('dashboard notifications',()=>{
  const crew:FireOpsUser={id:'crew-1',name:'Crew Member',role:'member'};
  const thread=(id:string,createdAt:string):CommunicationThread=>({id,subject:`Dispatch ${id}`,description:'Report to staging.',createdBy:'Company Owner',createdById:'owner-1',createdByRole:'owner',createdAt,replies:[]});
  const document=(id:string,updatedAt:string):CompanyDocument=>({id,name:`Document ${id}`,file:storedFile(`company/owner/${id}.pdf`),createdAt:updatedAt,updatedAt});

  it('combines communication and document notifications newest first',()=>{
    const notifications=dashboardNotifications(
      [thread('thread-1','2025-08-30T10:00:00Z')],
      [document('document-1','2025-08-30T11:00:00Z')],
      crew
    );
    expect(notifications.map(item=>item.source)).toEqual(['documents','communications']);
    expect(notifications.every(item=>item.unread)).toBe(true);
  });

  it('limits member notifications to 10 and hides section data from owners',()=>{
    const documents=Array.from({length:12},(_,index)=>document(`document-${index}`,`2025-08-30T${String(index).padStart(2,'0')}:00:00Z`));
    expect(dashboardNotifications([],documents,crew)).toHaveLength(10);
    expect(dashboardNotifications([],documents,{...crew,role:'owner'})).toEqual([]);
  });
});

describe('document unread rules',()=>{
  const document:CompanyDocument={id:'document-1',name:'Employee handbook',file:storedFile('company/owner/handbook.pdf'),createdAt:'2025-08-30T10:00:00Z',updatedAt:'2025-08-30T10:00:00Z'};

  it('notifies crew until latest document version is viewed',()=>{
    const crew:FireOpsUser={id:'crew-1',name:'Crew Member',role:'member'};
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
    expect(persisted.crew[0].credentials?.every(credential=>credential.file.dataUrl==='')).toBe(true);
    expect(current.vehicles[0].photo?.dataUrl).toContain('signed.example');
    expect(current.crew[0].credentials?.[0].file.dataUrl).toContain('signed.example');
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
