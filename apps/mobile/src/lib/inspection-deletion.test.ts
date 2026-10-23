import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';

// Exercise native confirmation callbacks without loading React Native.
const screen=readFileSync(new URL('../app/inspections.tsx',import.meta.url),'utf8');
const handler=screen.slice(screen.indexOf('  const confirmDelete='),screen.indexOf('  return <SafeAreaView'));
const javascript=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function setup({busy=false,failure=false,offline=false}={}){
  const alert=vi.fn();
  const deleteFleetInspection=failure?vi.fn().mockRejectedValue(new Error('Save failed')):vi.fn().mockResolvedValue(undefined);
  const setDeleting=vi.fn();const setDeleteError=vi.fn();
  const user={id:'owner-1',role:'owner'};
  const inspection={id:'inspection-1',items:[{id:'i1',result:'Fail'}]};
  const vehicle={id:'vehicle-1',name:'Engine 1',source:{inspections:[inspection]}};
  const deleteVehicleInspection=vi.fn().mockResolvedValue(undefined);
  const deviceSync={offline,userSync:{deleteVehicleInspection}};
  const confirm=new Function('Alert','deleteFleetInspection','member','deleting','setDeleting','setDeleteError','deviceSync',`${javascript}\nreturn confirmDelete;`)(
    {alert},deleteFleetInspection,{user},busy,setDeleting,setDeleteError,deviceSync,
  );
  confirm(vehicle,'inspection-1');
  return {alert,deleteFleetInspection,deleteVehicleInspection,setDeleting,setDeleteError,user,vehicle,inspection};
}

describe('failed inspection deletion confirmation',()=>{
  it('does not delete before confirmation or on cancel',()=>{
    const {alert,deleteFleetInspection}=setup();
    const buttons=alert.mock.calls[0][2];
    expect(buttons[0]).toEqual({text:'Cancel',style:'cancel'});
    expect(buttons[1].style).toBe('destructive');
    expect(deleteFleetInspection).not.toHaveBeenCalled();
  });

  it('deletes the selected inspection after confirmation',async()=>{
    const {alert,deleteFleetInspection,setDeleting,user,vehicle}=setup();
    alert.mock.calls[0][2][1].onPress();
    expect(deleteFleetInspection).toHaveBeenCalledWith(vehicle,'inspection-1',user);
    expect(setDeleting).toHaveBeenNthCalledWith(1,true);
    await vi.waitFor(()=>expect(setDeleting).toHaveBeenLastCalledWith(false));
  });

  it('shows save errors and permits retry',async()=>{
    const {alert,setDeleteError,setDeleting}=setup({failure:true});
    alert.mock.calls[0][2][1].onPress();
    await vi.waitFor(()=>expect(setDeleteError).toHaveBeenCalledWith('Save failed'));
    expect(setDeleting).toHaveBeenLastCalledWith(false);
  });

  it('offline, saves the delete on the device against the inspection as downloaded',async()=>{
    const {alert,deleteFleetInspection,deleteVehicleInspection,setDeleting,inspection}=setup({offline:true});
    alert.mock.calls[0][2][1].onPress();
    await vi.waitFor(()=>expect(setDeleting).toHaveBeenLastCalledWith(false));
    expect(deleteVehicleInspection).toHaveBeenCalledWith('vehicle-1',inspection);expect(deleteFleetInspection).not.toHaveBeenCalled();
  });

  it('ignores delete requests while saving',()=>{
    const {alert,deleteFleetInspection}=setup({busy:true});
    expect(alert).not.toHaveBeenCalled();
    expect(deleteFleetInspection).not.toHaveBeenCalled();
  });
});
