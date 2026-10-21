import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {continuationReviewHref,rebaseChoicesComplete,rebaseFieldText} from './offline-rebase-form';
import type {ContinuationReview} from './offline-outbox';

const review={fields:{notes:{before:{present:true,value:'Old'},saved:{present:true,value:'Saved'},current:{present:true,value:'Shared'}}}} as unknown as ContinuationReview;
describe('explicit rebase value selection',()=>{
  it('distinguishes missing, null, empty and numeric/string values',()=>{
    expect(rebaseFieldText({present:false})).toBe('Not present');expect(rebaseFieldText({present:true,value:null})).toBe('Null');expect(rebaseFieldText({present:true,value:''})).toBe('Empty text');
    expect(rebaseFieldText({present:true,value:'2024'})).toBe('"2024"');expect(rebaseFieldText({present:true,value:2024})).toBe('2024');
  });
  it('requires every choice without adding unoffered fields',()=>{
    expect(rebaseChoicesComplete(review,{})).toBe(false);expect(rebaseChoicesComplete(review,{notes:'saved'})).toBe(true);expect(rebaseChoicesComplete(review,{notes:'current',unit:'saved'})).toBe(false);
  });
  it('uses a fixed native review route',()=>{expect(continuationReviewHref('operation')).toEqual({pathname:'/rebase-details',params:{operationId:'operation'}})});
});

const source=readFileSync(new URL('../app/rebase-details.tsx',import.meta.url),'utf8');
function evaluate(start:string,end:string,env:Record<string,unknown>,result:string){
  const begin=source.indexOf(start);const code=ts.transpileModule(source.slice(begin,source.indexOf(end,begin)),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(env),`${code}\nreturn ${result};`)(...Object.values(env));
}
function fixture(){
  const saving={current:false};const generation={current:1};const editor={rebase:vi.fn().mockResolvedValue({status:'pending'})};const setSaved=vi.fn();const setBusy=vi.fn();const setError=vi.fn();
  const save=(choices:Record<string,'current'|'saved'>)=>evaluate('  const save=async()=>','  const confirm=',{review,choices,saving,generation,editor,setSaved,setBusy,setError,saved:false,rebaseChoicesComplete},'save') as ()=>Promise<void>;
  return {saving,generation,editor,setSaved,setBusy,setError,save};
}
describe('native rebase confirmation and durable feedback without UI launch',()=>{
  it('does not dispatch a local decision until confirmation',()=>{
    const alert=vi.fn();const save=vi.fn();const confirm=evaluate('  const confirm=','  const button=',{Alert:{alert},save},'confirm') as ()=>void;confirm();
    expect(save).not.toHaveBeenCalled();const buttons=alert.mock.calls[0][2];expect(buttons[0].style).toBe('cancel');buttons[1].onPress();expect(save).toHaveBeenCalledOnce();
  });
  it('does not claim rebased before its atomic SQLite operation completes',async()=>{
    const f=fixture();let commit!:(value:unknown)=>void;f.editor.rebase.mockReturnValue(new Promise(yes=>{commit=yes}));const running=f.save({notes:'saved'})();
    expect(f.setSaved).not.toHaveBeenCalled();commit({status:'pending'});await running;expect(f.setSaved).toHaveBeenCalledWith(true);
  });
  it('does not send incomplete choices',async()=>{const f=fixture();await f.save({})();expect(f.editor.rebase).not.toHaveBeenCalled()});
  it('retains errors and never claims success after storage failure',async()=>{
    const f=fixture();f.editor.rebase.mockRejectedValue(new Error('disk full'));await f.save({notes:'current'})();expect(f.setError).toHaveBeenCalledWith('disk full');expect(f.setSaved).not.toHaveBeenCalled();
  });
  it('ignores an old editor result after scope replacement',async()=>{
    const f=fixture();let commit!:(value:unknown)=>void;f.editor.rebase.mockReturnValue(new Promise(yes=>{commit=yes}));const running=f.save({notes:'saved'})();f.generation.current++;f.setBusy.mockClear();commit({status:'pending'});await running;
    expect(f.setSaved).not.toHaveBeenCalled();expect(f.setBusy).not.toHaveBeenCalled();
  });
});
