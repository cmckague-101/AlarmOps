import {describe,expect,it} from 'vitest';
import {
  DEFAULT_DISPATCH_CENTERS,
  DEFAULT_HAND_CREW_COORDINATOR,
  DEMO_MANIFEST_FLEET,
  MANIFEST_POSITION_OPTIONS,
  addDispatchCenter,
  addManifestVehicle,
  buildManifestShareText,
  canCreateCrewManifest,
  createAshleyNfRxDemoManifest,
  createBlankManifestPerson,
  createBlankManifestVehicle,
  emtColumnValue,
  emptyCrewManifest,
  fleetOptionsForManifest,
  hasManifestContacts,
  isManifestPersonIdentityLocked,
  manifestPersonFromCrewMember,
  patchManifestVehicle,
  removeManifestVehicle,
  renumberManifestPeople,
  selectedDispatchCenter,
  staffAssignmentOptions,
} from './crew-manifest';
import {assignableUserRoles,canViewCrewRoster,isCompanyManager,type CrewMember} from '@fireops/domain';

describe('canCreateCrewManifest',()=>{
  it('matches manager and roster access rules for every supported role',()=>{
    for(const role of ['owner',...assignableUserRoles.map(option=>option.value)] as const){
      expect(canCreateCrewManifest(role),role).toBe(isCompanyManager(role)&&canViewCrewRoster(role));
    }
  });
  it.each([['owner',true],['admin',true],['resource_boss',false],['fire_fighter',false],['shop_tech',false],['accounting',false]] as const)(
    '%s => %s',
    (role,allowed)=>{
      expect(canCreateCrewManifest(role)).toBe(allowed);
    },
  );
});

describe('Ashley NF RX demo manifest',()=>{
  it('ships Ops Clean people and vehicles without assigning operational contacts',()=>{
    const demo=createAshleyNfRxDemoManifest(new Date('2026-11-20T12:00:00-08:00'));
    expect(demo.moduleName).toBe('FIRECO MODULE');
    expect(demo.people).toHaveLength(10);
    expect(demo.people[0]?.position).toBe('Crew Supervisor');
    expect(demo.vehicles).toHaveLength(3);
    expect(demo.vehicles.every(vehicle=>vehicle.fromFleet&&vehicle.firNumber&&vehicle.make)).toBe(true);
    expect(demo.handCrewCoordinator).toEqual({personId:'',name:'',phone:''});
    expect(demo.selectedDispatchCenterId).toBe('');
    expect(selectedDispatchCenter(demo)).toBeUndefined();
    expect(MANIFEST_POSITION_OPTIONS).toContain('Saw Squad Boss');
  });
});

describe('manifest vehicles layer',()=>{
  it('never inserts demo vehicles into a live fleet, including an empty fleet',()=>{
    expect(fleetOptionsForManifest([],false)).toEqual([]);
    const liveVehicle={id:'live-vehicle',firNumber:'Engine 1',make:'Ford',model:'F-550',vin:'live-vin',plate:'LIVE'};
    expect(fleetOptionsForManifest([liveVehicle],false)).toEqual([liveVehicle]);
    const demoOptions=fleetOptionsForManifest([liveVehicle],true);
    expect(demoOptions).toContainEqual(liveVehicle);
    for(const vehicle of DEMO_MANIFEST_FLEET)expect(demoOptions).toContainEqual(vehicle);
  });
  it('starts live manifests without demo people, vehicles, incident, or notes',()=>{
    const manifest=emptyCrewManifest('Live Company');
    expect(manifest.moduleName).toBe('Live Company');
    expect(manifest.people).toEqual([]);
    expect(manifest.vehicles).toEqual([]);
    expect(manifest.incidentLabel).toBe('');
    expect(manifest.sheetNotes).toBe('');
    const text=buildManifestShareText(manifest,{name:'Live Company'}).body;
    expect(text).not.toContain('Ashley');
    for(const vehicle of DEMO_MANIFEST_FLEET)expect(text).not.toContain(vehicle.firNumber);
  });
  it('locks fleet identity and keeps notes freeform',()=>{
    const fleet=fleetOptionsForManifest([],true);
    expect(fleet.map(item=>item.id).sort()).toEqual(DEMO_MANIFEST_FLEET.map(item=>item.id).sort());
    const first=addManifestVehicle([],DEMO_MANIFEST_FLEET[0]!,'Overhead Rig');
    expect(first).toHaveLength(1);
    expect(first![0]?.firNumber).toBe(DEMO_MANIFEST_FLEET[0]!.firNumber);
    expect(addManifestVehicle(first!,DEMO_MANIFEST_FLEET[0]!)).toBeNull();
    const noted=patchManifestVehicle(first!,first![0]!.id,{notes:'Staging at ICP',firNumber:'HACK'});
    expect(noted[0]?.notes).toBe('Staging at ICP');
    expect(noted[0]?.firNumber).toBe(first![0]!.firNumber);
    const manual=createBlankManifestVehicle();
    const patched=patchManifestVehicle([manual],manual.id,{firNumber:'Custom-1',notes:'Saw support'});
    expect(patched[0]?.firNumber).toBe('Custom-1');
    expect(patched[0]?.notes).toBe('Saw support');
    expect(removeManifestVehicle(noted,noted[0]!.id)).toEqual([]);
  });
});

describe('people + EMT',()=>{
  it('locks roster/demo identity and keeps EMT Y/blank',()=>{
    const member={
      id:'crew-1',
      name:'Alex Rivera',
      email:'alex@example.com',
      phone:'(208) 555-0100',
      role:'fire_fighter',
      status:'Active',
      credentialName:'EMT',
      credentials:[],
    } as unknown as CrewMember;
    const person=manifestPersonFromCrewMember(member,1);
    expect(isManifestPersonIdentityLocked(person)).toBe(true);
    expect(emtColumnValue(person.medicMark)).toBe('Y');
    expect(emtColumnValue(null)).toBe('');
    const manual=createBlankManifestPerson(2);
    expect(isManifestPersonIdentityLocked(manual)).toBe(false);
    expect(renumberManifestPeople([person,manual]).map(item=>item.lineNumber)).toEqual([1,2]);
  });
});

describe('dispatch + staff + share',()=>{
  it('includes edited personnel, vehicle, notes, and company contact details in share text',()=>{
    const manifest=emptyCrewManifest('Test Company');
    manifest.people=[{...createBlankManifestPerson(1),name:'Alex Example',dob:'01/02/1990',sex:'F',phone:'555-0101',position:'Squad Boss',additionalQuals:['FFT1'],medicMark:'emt',notes:'Meet at staging'}];
    manifest.vehicles=[{...createBlankManifestVehicle(),firNumber:'Engine 7',make:'Ford',model:'F-550',vin:'TESTVIN123',plate:'ABC123',notes:'Bring spare hose'}];
    manifest.sheetNotes='Briefing at 0600';
    const {body}=buildManifestShareText(manifest,{name:'Test Company',ownerEmail:'owner@example.com'});
    for(const value of ['Alex Example','01/02/1990','M/F F','555-0101','Squad Boss','FFT1','EMT Y','Meet at staging','Engine 7','Ford F-550','TESTVIN123','ABC123','Bring spare hose','Briefing at 0600','owner@example.com'])expect(body).toContain(value);
  });
  it.each(['live','demo'] as const)('requires explicit contact selections in %s manifests and share text',mode=>{
    const manifest=mode==='live'?emptyCrewManifest('Test Company'):createAshleyNfRxDemoManifest();
    expect(manifest.handCrewCoordinator).toEqual({personId:'',name:'',phone:''});
    expect(manifest.dispatchCenters).toEqual([]);
    expect(selectedDispatchCenter(manifest)).toBeUndefined();
    expect(hasManifestContacts(manifest)).toBe(false);
    const share=()=>buildManifestShareText(manifest,{name:'Test Company'}).body;
    expect(share()).not.toMatch(/Christopher Hansen|995-1385|Boise Dispatch|384-3400/);
    const added=addDispatchCenter(manifest.dispatchCenters,{name:'Boise Dispatch',phone:'(208) 384-3400'});
    expect(added).not.toBeNull();
    manifest.dispatchCenters=added!.centers;
    manifest.handCrewCoordinator={personId:'crew-1',name:'Selected Coordinator',phone:'555-0100'};
    manifest.selectedDispatchCenterId=added!.added.id;
    expect(hasManifestContacts(manifest)).toBe(true);
    expect(share()).toContain('Selected Coordinator · 555-0100');
    expect(share()).toContain('Dispatch Center: Boise Dispatch');
    manifest.handCrewCoordinator={...DEFAULT_HAND_CREW_COORDINATOR};
    manifest.selectedDispatchCenterId='';
    expect(hasManifestContacts(manifest)).toBe(false);
    expect(share()).not.toContain('Selected Coordinator');
    expect(share()).not.toContain('Boise Dispatch');
    manifest.selectedDispatchCenterId='missing-dispatch';
    expect(selectedDispatchCenter(manifest)).toBeUndefined();
    expect(share()).not.toContain('Boise Dispatch');
  });
  it('adds dispatch centers and builds company-stamped share copy',()=>{
    const centers=DEFAULT_DISPATCH_CENTERS.map(center=>({...center}));
    const added=addDispatchCenter(centers,{name:'NIFC Boise',phone:'(208) 555-0100'});
    expect(added?.added.name).toBe('NIFC Boise');
    expect(addDispatchCenter(added!.centers,{name:'nifc boise'})).toBeNull();
    const options=staffAssignmentOptions([],DEFAULT_HAND_CREW_COORDINATOR);
    expect(options).toEqual([]);
    const demo=createAshleyNfRxDemoManifest();
    const share=buildManifestShareText(demo,{
      name:'FireCo LLC',
      phone:'(208) 861-7464',
      location:'Boise, ID',
      ownerName:'Clint McCaig',
      ownerEmail:'Clint@firecollc.com',
    });
    expect(share.subject).toContain('FireCo LLC');
    expect(share.body).toContain('FireCo LLC');
    expect(share.body).toContain('Clint McCaig');
    expect(share.body).not.toMatch(/FireOps/i);
    expect(share.body).toContain('Crew Coordinator');
    expect(share.body).toContain('Dispatch Center');
  });
});
