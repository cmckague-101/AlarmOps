import {describe, expect, it} from 'vitest';
import type {FleetSnapshot, VehicleFile} from './App';
import {snapshotFilePaths, stripSignedFileUrls} from './FleetApp';

const storedFile = (path:string):VehicleFile => ({name:'document.pdf',type:'application/pdf',dataUrl:'https://signed.example/file',path});

function snapshot():FleetSnapshot {
  return {
    vehicles:[{
      id:'11111111-1111-4111-8111-111111111111',unit:'Engine 1',type:'Type 3 Engine',year:2024,
      make:'International',model:'HV',vin:'',plate:'',status:'Ready',createdAt:'2025-01-01',
      photo:storedFile('company/user/photo.webp'),insurance:storedFile('company/user/insurance.pdf'),
    }],
    issues:[],
    crew:[{id:'22222222-2222-4222-8222-222222222222',name:'Crew Member',email:'crew@example.com',phone:'',role:'member',status:'Active',credential:storedFile('company/owner/credential.pdf')}],
    activities:[],
  };
}

describe('fleet file persistence',()=>{
  it('removes expiring signed URLs without mutating UI state',()=>{
    const current=snapshot();
    const persisted=stripSignedFileUrls(current);

    expect(persisted.vehicles[0].photo?.dataUrl).toBe('');
    expect(persisted.vehicles[0].insurance?.dataUrl).toBe('');
    expect(persisted.crew[0].credential?.dataUrl).toBe('');
    expect(current.vehicles[0].photo?.dataUrl).toContain('signed.example');
  });

  it('collects every referenced storage path for orphan cleanup',()=>{
    expect([...snapshotFilePaths(snapshot())].sort()).toEqual([
      'company/owner/credential.pdf',
      'company/user/insurance.pdf',
      'company/user/photo.webp',
    ]);
  });
});
