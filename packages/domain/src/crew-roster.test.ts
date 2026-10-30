import {describe,expect,it} from 'vitest';
import type {CrewMember} from './models';
import {filterAndSortCrew} from './crew-roster';

const person=(name:string,role:CrewMember['role'],status:CrewMember['status'],email=`${name.toLowerCase()}@example.com`)=>({name,email,role,status});
const crew=[person('Zoe','fire_fighter','Active'),person('Ann','admin','Active'),person('Bob','fire_fighter','Invited'),person('Cal','owner','Active')];

describe('filterAndSortCrew',()=>{
  it('sorts by name',()=>{expect(filterAndSortCrew(crew,'','name').map(p=>p.name)).toEqual(['Ann','Bob','Cal','Zoe'])});
  it('puts invited members first when sorting by status',()=>{expect(filterAndSortCrew(crew,'','status').map(p=>p.name)).toEqual(['Bob','Ann','Cal','Zoe'])});
  it('orders by role, then name',()=>{expect(filterAndSortCrew(crew,'','role').map(p=>p.name)).toEqual(['Cal','Ann','Bob','Zoe'])});
  it('searches name, email and role label',()=>{expect(filterAndSortCrew(crew,'zoe','name').map(p=>p.name)).toEqual(['Zoe']);expect(filterAndSortCrew(crew,'ADMIN','name').map(p=>p.name)).toEqual(['Ann'])});
  it('does not mutate the input',()=>{const copy=[...crew];filterAndSortCrew(crew,'','name');expect(crew).toEqual(copy)});
});
