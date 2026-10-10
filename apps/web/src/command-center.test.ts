import {describe,it,expect} from 'vitest';
import {commandCenter,type CrewMember,type FleetIssue} from '@fireops/domain';
const crew:CrewMember[]=[{id:'a',name:'Alex',email:'',phone:'',role:'fire_fighter',status:'Active'},{id:'b',name:'Blair',email:'',phone:'',role:'shop_tech',status:'Active'}];
const fire={id:'fire',name:'Walker Fire',state:'OR'};
describe('owner command center',()=>{
  it('groups fires, counts people once, and preserves every vehicle assignment',()=>{
    const cards=commandCenter([{id:'1',unit:'Engine 1',status:'Assigned',assignedTo:'a',assignedFire:fire},{id:'2',unit:'Engine 2',status:'Assigned',assignedTo:'a',assignedFire:fire},{id:'3',unit:'Tender',status:'Assigned',assignedTo:'b'},{id:'4',unit:'Spare',status:'Ready'}],crew,[]);
    expect(cards.map(c=>c.rows.length)).toEqual([1,2,3,0]);
    expect(cards[0].rows[0].target).toEqual({type:'incident',id:'fire'});
    expect(cards[0].rows[0].lines).toEqual(['Engine 1 · Engine 2','1 personnel']);
    expect(cards[1].rows[0].lines).toHaveLength(2);
    expect(cards[2].summary).toBe('1 available');
    expect(cards[2].rows[2].detail).toBe('No fire assigned');
  });
  it('lists all unresolved issues with critical first, including missing vehicles',()=>{
    const issue={vehicleId:'missing',description:'Review',status:'Open',updates:[],createdBy:'Alex',createdAt:'2026-01-01'};
    const issues=[{...issue,id:'low',title:'Low issue',priority:'Low'},{...issue,id:'critical',title:'Critical issue',priority:'Critical'},{...issue,id:'resolved',title:'Done',priority:'High',status:'Resolved'}] as FleetIssue[];
    const attention=commandCenter([],crew,issues)[3];
    expect(attention.rows.map(r=>r.id)).toEqual(['critical','low']);
    expect(attention.summary).toBe('1 critical alerts');
    expect(attention.rows[0].target).toEqual({type:'issue',id:'critical'});
  });
});
