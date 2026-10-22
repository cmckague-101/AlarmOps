import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {offlineDetailFormChanges,offlineDetailFormValues} from './offline-detail-form';
import type {OfflineDetailDraft} from './offline-detail-editor';

// Exercise real screen callbacks with injected dependencies; no native UI or app server.
const source=readFileSync(new URL('../app/saved-details.tsx',import.meta.url),'utf8');
function compile(chunk:string,env:Record<string,unknown>,result:string){
  const javascript=ts.transpileModule(chunk,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const jsx=(type:unknown,props:unknown,key:unknown)=>({type,props,key});
  return new Function('require','exports',...Object.keys(env),`${javascript}\nreturn ${result};`)(()=>({jsx,jsxs:jsx}),{},...Object.values(env));
}
const draft:OfflineDetailDraft={entityType:'vehicle',entityId:'vehicle',revision:'1',verifiedAt:'2026-01-01',record:{id:'vehicle',unit:'E1',type:'Engine',year:2024,make:'Ford',model:'F',notes:'Base'}};
function saveSetup(){
  const state={draft,form:{...offlineDetailFormValues(draft),notes:'Typed'} as Record<string,string>,saved:false,saving:false,frozen:false,retryValues:null as unknown,error:''};
  const busy={current:false};const generation={current:1};const editor={save:vi.fn().mockResolvedValue({status:'pending'})};
  const setSaved=vi.fn((value:boolean)=>{state.saved=value});const setSaving=vi.fn((value:boolean)=>{state.saving=value});
  const save=()=>compile(source.slice(source.indexOf('  const save=async()=>'),source.indexOf('  return <SafeAreaView',source.indexOf('  const save=async()=>'))),{
    ...state,busy,generation,editor,offlineDetailFormChanges,setError:(value:string)=>{state.error=value},setFrozen:(value:boolean)=>{state.frozen=value},setRetryValues:(value:unknown)=>{state.retryValues=value},setSaved,setSaving,
  },'save') as ()=>Promise<void>;
  return {state,busy,generation,editor,setSaved,setSaving,save};
}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}

describe('mobile saved-detail persistence feedback',()=>{
  it('reports saved only after durable enqueue resolves, never merely after clicking Save',async()=>{
    const f=saveSetup();const committed=deferred();f.editor.save.mockReturnValue(committed.promise);const running=f.save()();
    expect(f.state.saving).toBe(true);expect(f.state.frozen).toBe(true);expect(f.setSaved).not.toHaveBeenCalled();expect(f.editor.save).toHaveBeenCalledWith(draft,{notes:'Typed'});
    committed.resolve({status:'pending'});await running;expect(f.state.saved).toBe(true);expect(f.state.saving).toBe(false);
  });
  it('preserves failed-save values and retries the original body instead of newer input',async()=>{
    const f=saveSetup();f.editor.save.mockRejectedValueOnce(new Error('disk full'));await f.save()();
    expect(f.state.saved).toBe(false);expect(f.state.frozen).toBe(true);expect(f.state.error).toBe('disk full');expect(f.state.retryValues).toEqual({notes:'Typed'});
    f.state.form.notes='Unsent change';await f.save()();expect(f.editor.save.mock.calls[1]).toEqual([draft,{notes:'Typed'}]);
  });
  it('does not freeze invalid/no-op inputs or claim they were saved',async()=>{
    const f=saveSetup();f.state.form=offlineDetailFormValues(draft);await f.save()();
    expect(f.state.error).toContain('No detail changes');expect(f.state.frozen).toBe(false);expect(f.editor.save).not.toHaveBeenCalled();
  });
  it('coalesces rapid Save taps before React has rerendered disabled controls',async()=>{
    const f=saveSetup();const committed=deferred();f.editor.save.mockReturnValue(committed.promise);const save=f.save();const first=save();await save();
    expect(f.editor.save).toHaveBeenCalledTimes(1);committed.resolve({status:'pending'});await first;
  });
  it('ignores late results after editor/scope replacement or unmount',async()=>{
    const f=saveSetup();const committed=deferred();f.editor.save.mockReturnValue(committed.promise);const running=f.save()();
    f.generation.current++;f.setSaved.mockClear();f.setSaving.mockClear();committed.resolve({status:'pending'});await running;
    expect(f.setSaved).not.toHaveBeenCalled();expect(f.setSaving).not.toHaveBeenCalled();
  });
});

describe('installed-app and current-identity route guards',()=>{
  function route(options:{platform?:string;role?:string;sessionUser?:string;demo?:boolean;entityType?:string}={}){
    const DetailForm=()=>{};const refresh=vi.fn();const editor={prepare:vi.fn(),save:vi.fn()};
    const screen=compile(source.slice(source.indexOf('export default function SavedDetailsScreen'),source.indexOf('function DetailForm(')),{
      useLocalSearchParams:()=>({entityType:options.entityType??'vehicle',entityId:'vehicle'}),useSession:()=>({session:{user:{id:options.sessionUser??'user'}},demoMode:options.demo??false,access:{status:'ready',value:{kind:'member',company:{id:'company'},user:{id:'user',role:options.role??'owner'}}}}),
      useOfflineSync:()=>({detailEditor:editor,loading:false,refresh}),useFireOpsTheme:()=>({}),Platform:{OS:options.platform??'ios'},SafeAreaView:'safe',Stack:{Screen:'screen'},View:'view',Text:'text',Pressable:'button',DetailForm,styles:{},
    },'SavedDetailsScreen') as ()=>{type:unknown;props:{target?:unknown;crewMode?:boolean};key:string};
    return {value:screen(),DetailForm,editor};
  }
  it('opens only a scoped native owner/admin editor with stable identity/target key',()=>{
    const f=route();expect(f.value.type).toBe(f.DetailForm);expect(f.value.props.target).toEqual({entityType:'vehicle',entityId:'vehicle'});expect(f.value.key).toBe('user:company:owner:vehicle:vehicle');
    expect(route({role:'admin',platform:'android'}).value.key).toContain(':admin:');
  });
  it.each(['shop_tech','fire_fighter'])('gives %s the restricted crew editor only',role=>{
    const f=route({role});expect(f.value.type).toBe(f.DetailForm);expect(f.value.props.crewMode).toBe(true);expect(route().value.props.crewMode).toBe(false);
  });
  it.each([{platform:'web'},{role:'viewer'},{sessionUser:'other'},{demo:true},{entityType:'crew'}])('does not expose save form for %j',options=>{
    const f=route(options);expect(f.value.type).not.toBe(f.DetailForm);expect(f.editor.prepare).not.toHaveBeenCalled();expect(f.editor.save).not.toHaveBeenCalled();
  });
});
