import {describe, expect, it} from 'vitest';
import type {FleetSnapshot, VehicleFile} from './App';
import {accountAccessErrorMessage, snapshotFilePaths, stripSignedFileUrls} from './FleetApp';

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
