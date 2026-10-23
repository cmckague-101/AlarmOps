import {describe,expect,it,vi} from 'vitest';
const files=vi.hoisted(()=>new Map<string,string>());
vi.mock('expo-file-system',()=>({Paths:{document:'doc'},File:class{name:string;constructor(_dir:string,name:string){this.name=name}get exists(){return files.has(this.name)}write(value:string){files.set(this.name,value)}async text(){return files.get(this.name)??''}}}));
import {decodeFireList,readFireList,saveFireList} from './offline-fire-list';
// Downloaded fire list for offline assignment (no network, device or UI).
const fire=(id:string,changes={})=>({id,name:`Fire ${id}`,state:'CA',acres:1,contained:0,personnel:null,discovered:null,updated:null,latitude:1,longitude:2,...changes});
describe('downloaded fire list',()=>{
  it('keeps only id, name and state and reads back what was saved',async()=>{
    expect(await readFireList()).toBeNull();
    saveFireList([fire('a'),fire('b',{name:''})],'2026-07-01T00:00:00.000Z');
    expect(await readFireList()).toEqual({savedAt:'2026-07-01T00:00:00.000Z',fires:[{id:'a',name:'Fire a',state:'CA'}]});
  });
  it('rejects malformed stored lists',()=>{
    for(const bad of [null,{savedAt:'x',fires:[]},{savedAt:'2026-07-01T00:00:00Z',fires:[{id:'a',name:'b'}]},{savedAt:'2026-07-01T00:00:00Z',fires:{}}])expect(decodeFireList(bad)).toBeNull();
  });
});
