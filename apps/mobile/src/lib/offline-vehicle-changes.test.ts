import {describe,expect,it} from 'vitest';
import {offlineVehicleChange,offlineVehicleChangeKey} from './offline-vehicle-changes';

describe('offline vehicle changes',()=>{
  const assigned={status:'Assigned',assignedTo:'crew-1',assignedFire:{id:'f1',name:'Ridge',state:'CA'}};
  it('clears present assignment fields when status changes',()=>{
    expect(offlineVehicleChange({kind:'status',status:'Out of service'},assigned)).toEqual({values:{status:'Out of service'},extras:{remove:['assignedTo','assignedFire']}});
    expect(offlineVehicleChange({kind:'status',status:'Ready'},{status:'Out of service'})).toEqual({values:{status:'Ready'},extras:{remove:[]}});
  });
  it('assigns a crew member and marks the vehicle Assigned',()=>{
    expect(offlineVehicleChange({kind:'assign',memberId:'crew-2'},{status:'Ready'})).toEqual({values:{status:'Assigned',assignedTo:'crew-2'},extras:{}});
  });
  it('returns an assigned vehicle to Ready on release and keeps other statuses',()=>{
    expect(offlineVehicleChange({kind:'unassign'},assigned).values).toEqual({status:'Ready'});
    expect(offlineVehicleChange({kind:'unassign'},{status:'Out of service',assignedTo:'crew-1'})).toEqual({values:{status:'Out of service'},extras:{remove:['assignedTo']}});
  });
  it('sets and clears the fire assignment',()=>{
    expect(offlineVehicleChange({kind:'fire',fire:{id:'f2',name:'Canyon',state:'OR'}},assigned).values).toEqual({assignedFire:{id:'f2',name:'Canyon',state:'OR'}});
    expect(offlineVehicleChange({kind:'clearFire'},assigned)).toEqual({values:{},extras:{remove:['assignedFire']}});
  });
  it('keys changes by what they do',()=>{
    expect(offlineVehicleChangeKey({kind:'assign',memberId:'crew-2'})).toBe('assign:crew-2');
    expect(offlineVehicleChangeKey({kind:'fire',fire:{id:'f2',name:'Canyon',state:'OR'}})).toBe('fire:f2');
    expect(offlineVehicleChangeKey({kind:'clearFire'})).toBe('fire');
  });
});
