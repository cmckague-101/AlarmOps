import {describe,expect,it} from 'vitest';
import {commandAlerts} from './command-center';
import {nextOilChangeWarning} from './oil-change';

const noon=new Date(2027,0,5,12);

describe('nextOilChangeWarning',()=>{
  it('warns on or after the due date, not before',()=>{
    expect(nextOilChangeWarning({nextOilChangeDue:'2027-01-06'},noon)).toBeNull();
    expect(nextOilChangeWarning({nextOilChangeDue:'2027-01-05',nextOilChange:' 45,000 mi '},noon)).toEqual({due:'2027-01-05',note:'45,000 mi',expired:false});
    expect(nextOilChangeWarning({nextOilChangeDue:'2026-12-01'},noon)).toEqual({due:'2026-12-01',note:undefined,expired:true});
  });
  it('ignores missing or invalid dates',()=>{
    for(const nextOilChangeDue of [undefined,'','2027-02-30','01/05/2027'])expect(nextOilChangeWarning({nextOilChangeDue},noon)).toBeNull();
  });
  it('adds an urgent Command Center alert that opens the vehicle',()=>{
    const alerts=commandAlerts([{id:'v1',unit:'Engine 7',status:'Ready',nextOilChange:'250 hrs',nextOilChangeDue:'2027-01-05'},{id:'v2',unit:'Engine 8',status:'Ready',nextOilChangeDue:'2027-02-01'}],[],[],noon,[]);
    expect(alerts).toEqual([expect.objectContaining({id:'oil-change-v1',kind:'vehicle',title:'Engine 7 needs attention — oil change due',detail:'250 hrs · Due 2027-01-05',urgent:true,target:{type:'vehicle',id:'v1'}})]);
  });
});
