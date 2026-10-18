import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';

// Exercise the native alert callbacks without loading the React Native runtime.
const screen=readFileSync(new URL('../app/crew/[id].tsx',import.meta.url),'utf8');
const handlers=screen.slice(screen.indexOf(' const confirmRemoval='),screen.indexOf(' return <SafeAreaView'));

function setup({failure,busy=false,hasOwner=true}:{failure?:Error;busy?:boolean;hasOwner?:boolean}={}){
  const alert=vi.fn();
  const removeCrewMember=failure?vi.fn().mockRejectedValue(failure):vi.fn().mockResolvedValue({removed:true});
  const router={back:vi.fn()};
  const setBusy=vi.fn();
  const setError=vi.fn();
  const remove=new Function('Alert','removeCrewMember','router','setBusy','setError','owner','member','busy',`${handlers}\nreturn remove;`)(
    {alert},removeCrewMember,router,setBusy,setError,hasOwner?{company:{id:'company-1'}}:null,{id:'crew-1',name:'Crew Member'},busy,
  );
  remove();
  const buttons=alert.mock.calls[0][2] as {text:string;onPress?:()=>void}[];
  return {buttons,removeCrewMember,router,setBusy,setError};
}

describe('mobile crew removal confirmation',()=>{
  it('does not remove anyone before confirmation or when cancelled',()=>{
    const {buttons,removeCrewMember}=setup();
    expect(buttons[0].text).toBe('Cancel');
    buttons[0].onPress?.();
    expect(removeCrewMember).not.toHaveBeenCalled();
  });

  it('executes removal when the native destructive button is pressed',async()=>{
    const {buttons,removeCrewMember,router,setBusy,setError}=setup();
    buttons[1].onPress?.();
    expect(removeCrewMember).toHaveBeenCalledWith('company-1','crew-1');
    expect(setBusy).toHaveBeenNthCalledWith(1,true);
    expect(setError).toHaveBeenCalledWith('');
    await vi.waitFor(()=>expect(router.back).toHaveBeenCalledOnce());
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it('shows removal errors and enables retry without navigating away',async()=>{
    const {buttons,router,setBusy,setError}=setup({failure:new Error('Removal failed')});
    buttons[1].onPress?.();
    await vi.waitFor(()=>expect(setError).toHaveBeenCalledWith('Removal failed'));
    expect(router.back).not.toHaveBeenCalled();
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it.each([{busy:true},{hasOwner:false}])('ignores unavailable removal actions: %j',async(options)=>{
    const {buttons,removeCrewMember}=setup(options);
    buttons[1].onPress?.();
    await Promise.resolve();
    expect(removeCrewMember).not.toHaveBeenCalled();
  });
});
