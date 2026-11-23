import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {normalizeVehicle,type FleetIssue,type FleetSnapshot,type Vehicle} from '@fireops/domain';
import {createOnlineFleetEditSession} from './online-fleet-edit-session';

const source=readFileSync(new URL('./App.tsx',import.meta.url),'utf8');
function handler(start:string,end:string,env:Record<string,unknown>,name:string,offset=0){
  const index=source.indexOf(start,offset);const chunk=source.slice(index,source.indexOf(end,index));
  const js=ts.transpileModule(chunk,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(env),`${js}\nreturn ${name};`)(...Object.values(env));
}
const vehicle=():Vehicle=>({id:'vehicle',unit:'E1',type:'Engine',year:2024,make:'Ford',model:'F',vin:'',plate:'',notes:'Original',status:'Ready',createdAt:'2026-01-01'});
const issue=():FleetIssue=>({id:'issue',vehicleId:'vehicle',title:'Leak',description:'Inspect',priority:'Low',status:'Open',updates:[],createdBy:'Owner',createdById:'user',createdAt:'2026-01-01'});
const snapshot=(row=vehicle()):FleetSnapshot=>({vehicles:[row],issues:[],crew:[],activities:[]});

describe('production web edit/save callbacks without mounting UI',()=>{
  function vehicleForm(accept=true){
    const custom={id:'custom',name:'Custom document',file:{name:'custom.pdf',type:'application/pdf',dataUrl:'',path:'custom/file'}};
    const original={...vehicle(),inspections:[],documents:[custom],viprCategory:'Engine',pumpGpm:150};const form={...original,unit:'Typed unit',year:'2024',notes:'Typed notes'};
    const onSave=vi.fn().mockReturnValue(accept);const onCommitFiles=vi.fn();const setErrors=vi.fn();
    const submit=handler('  const submit=(e:React.FormEvent<HTMLFormElement>)=>','  if(managingTypes)',{
      documents:{},inspectionExpirationDate:()=> '2027-01-01',form,selectedType:'Engine',setErrors,focusFirstInvalid:vi.fn(),onSave,onCommitFiles,vehicle:original,photo:undefined,documentList:[],vehicleDocumentOptions:[{key:'insurance',label:'Insurance'}],
    },'submit',source.indexOf('function VehicleForm(')) as (event:unknown)=>void;
    return {submit,onSave,onCommitFiles,setErrors,original,form,custom};
  }
  it('preserves non-edited vehicle fields and custom documents in the actual submitted record',()=>{
    const f=vehicleForm();f.submit({preventDefault:vi.fn(),currentTarget:{}});
    expect(f.onSave).toHaveBeenCalledWith(expect.objectContaining({unit:'Typed unit',notes:'Typed notes',inspections:[],documents:[f.custom],viprCategory:'Engine',pumpGpm:150}));expect(f.onCommitFiles).toHaveBeenCalledOnce();
  });
  it('keeps stale/rejected vehicle inputs and uploaded-file ownership instead of committing them',()=>{
    const f=vehicleForm(false);f.submit({preventDefault:vi.fn(),currentTarget:{}});
    expect(f.onCommitFiles).not.toHaveBeenCalled();expect(f.setErrors).toHaveBeenLastCalledWith({record:expect.stringContaining('entered values remain')});expect(f.form.notes).toBe('Typed notes');
  });
  it('rejects a vehicle editor whose original object was superseded by mobile/server sync',()=>{
    const original=vehicle();const setVehicles=vi.fn();const showNotice=vi.fn();
    const update=handler('  const updateVehicle =','  const updateVehiclePhoto =',{
      canManageFleet:true,allowLocalChange:()=>true,onDataChange:()=>{},editing:original,latestSnapshot:{current:snapshot({...original,notes:'Mobile edit'})},showNotice,setVehicles,normalizeVehicle,
    },'updateVehicle') as (value:Vehicle)=>boolean;
    expect(update({...original,unit:'Typed unit'})).toBe(false);expect(setVehicles).not.toHaveBeenCalled();expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('values remain'));
  });
  it('submits issue details against their captured original issue, not a newer live prop',()=>{
    const original=issue();const onSave=vi.fn().mockReturnValue(false);const setEditingDetails=vi.fn();const setDetailErrors=vi.fn();
    const save=handler('  const saveDetails=(event:React.FormEvent<HTMLFormElement>)=>','  const saveUpdate=',{
      canManage:true,details:{title:'Typed title',description:'Typed description',priority:'High'},setDetailErrors,focusFirstInvalid:vi.fn(),onSave,detailBase:{current:original},issue:{...original,description:'Mobile edit'},setEditingDetails,
    },'saveDetails',source.indexOf('function IssueDetail(')) as (event:unknown)=>void;
    save({preventDefault:vi.fn(),currentTarget:{}});
    expect(onSave).toHaveBeenCalledWith({...original,title:'Typed title',description:'Typed description',priority:'High'},original);expect(setEditingDetails).not.toHaveBeenCalled();expect(setDetailErrors).toHaveBeenLastCalledWith({record:expect.stringContaining('values remain')});
  });
  it('rejects a stale issue base before mutating local lists',()=>{
    const original=issue();const setIssues=vi.fn();
    const update=handler('  const updateIssue =','  const addInspection =',{
      allowLocalChange:()=>true,issues:[{...original,description:'Mobile edit'}],onDataChange:()=>{},showNotice:vi.fn(),setIssues,
    },'updateIssue') as (value:FleetIssue,base:FleetIssue)=>boolean;
    expect(update({...original,title:'Typed title'},original)).toBe(false);expect(setIssues).not.toHaveBeenCalled();
  });
  it('rejects a stale post-upload photo update rather than writing an older whole vehicle',async()=>{
    const original=vehicle();const latestSnapshot={current:snapshot(original)};let complete!:(value:unknown)=>void;const uploadFile=vi.fn(()=>new Promise(resolve=>{complete=resolve}));const setVehicles=vi.fn();const onCommitFiles=vi.fn();
    const update=handler('  const updateVehiclePhoto =','  const deleteVehicle =',{
      canManageFleet:true,allowLocalChange:()=>true,uploadFile,onDataChange:()=>{},latestSnapshot,normalizeVehicle,setVehicles,onCommitFiles,
    },'updateVehiclePhoto') as (value:Vehicle,file:unknown)=>Promise<void>;
    const result=expect(update(original,{})).rejects.toThrow('Vehicle changed while uploading');latestSnapshot.current=snapshot({...original,notes:'Mobile update'});
    complete({name:'photo.jpg',dataUrl:'',path:'new/photo'});await result;expect(setVehicles).not.toHaveBeenCalled();expect(onCommitFiles).not.toHaveBeenCalled();
  });
});

describe('production debounce effect with captured retry payload',()=>{
  function effectSetup(fail=false){
    const onlineEdits=createOnlineFleetEditSession();const before=snapshot();onlineEdits.begin(before);const typed=snapshot({...vehicle(),notes:'Typed'});const latestSnapshot={current:typed};
    const onDataChange=fail?vi.fn().mockRejectedValueOnce(new Error('Network lost')).mockResolvedValue(undefined):vi.fn().mockResolvedValue(undefined);
    const setSaveState=vi.fn();const setStorageError=vi.fn();const applyRemoteChange=vi.fn();let fire!:()=>Promise<void>;
    const run=()=>handler('  useEffect(() => {\n    // Every local fleet mutation','  const logActivity =',{
      useEffect:(fn:()=>unknown)=>fn(),localRevision:1,saveAttempt:0,onDataChange,onlineEdits,latestSnapshot,window:{setTimeout:(fn:()=>Promise<void>)=>{fire=fn;return 1},clearTimeout:vi.fn()},setSaveState,setStorageError,applyRemoteChange,
    },'undefined');
    return {onlineEdits,before,latestSnapshot,onDataChange,setSaveState,setStorageError,applyRemoteChange,run,fire:()=>fire()};
  }
  it('freezes intended values before debounce and defers incoming server changes until acknowledgment',async()=>{
    const f=effectSetup();f.run();const incoming={collection:'vehicles' as const,event:'upsert' as const,record:{...vehicle(),notes:'Mobile change'},sequence:1};f.onlineEdits.buffer(incoming);
    f.latestSnapshot.current=snapshot({...vehicle(),notes:'Newer render'});await f.fire();
    expect(f.onDataChange.mock.calls[0][0].vehicles[0].notes).toBe('Typed');expect(f.onDataChange.mock.calls[0][1]).toBe(f.before);expect(f.applyRemoteChange.mock.calls[0][0]).toBe(incoming);expect(f.setSaveState).toHaveBeenLastCalledWith('saved');
  });
  it('retains unconfirmed values on failure and retries the identical captured snapshot',async()=>{
    const f=effectSetup(true);f.run();await f.fire();expect(f.onlineEdits.pending).toBe(true);expect(f.setSaveState).toHaveBeenLastCalledWith('error');
    f.latestSnapshot.current=snapshot({...vehicle(),notes:'Newer render must not replace request'});f.run();await f.fire();
    expect(f.onDataChange.mock.calls[1][0]).toBe(f.onDataChange.mock.calls[0][0]);expect(f.onDataChange.mock.calls[1][1]).toBe(f.before);expect(f.onlineEdits.pending).toBe(false);
  });
});
