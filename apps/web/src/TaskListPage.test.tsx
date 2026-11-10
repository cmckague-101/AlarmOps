import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
const mocks=vi.hoisted(()=>({save:vi.fn(),remove:vi.fn()}));
const tasks=[{id:'first',company_id:'company',user_id:'user',subject:'First task',description:'First details',due_date:'2027-01-05',created_at:''},{id:'second',company_id:'company',user_id:'user',subject:'Second task',description:'Second details',due_date:'2027-01-06',created_at:''}];
vi.mock('./usePersonalTasks',()=>({usePersonalTasks:()=>({tasks,save:mocks.save,remove:mocks.remove,loading:false,busy:false,error:'',connected:true,retry:vi.fn()})}));
import {TaskListPage} from './TaskListPage';

type Node={type:unknown;key?:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
function screen(){
  const frame=runtime.frame();
  const render=()=>{runtime.enter(frame);return TaskListPage({companyId:'company',user:{id:'user',name:'Alex',role:'owner'},onBack:vi.fn()})};
  return {render,click(tree:unknown,label:string){const button=nodes(tree).find(node=>node.type==='button'&&(node.props['aria-label']===label||node.props.children===label));expect(button).toBeDefined();(button!.props.onClick as ()=>void)()}};
}
beforeEach(()=>{vi.clearAllMocks();mocks.save.mockResolvedValue(true)});

describe('inline task editing',()=>{
  it('expands only the selected card, with no separate or duplicate task details',()=>{
    const s=screen();s.click(s.render(),'Edit Second task');const tree=s.render();
    const cards=nodes(tree).filter(node=>node.type==='article');expect(cards).toHaveLength(2);
    expect(nodes(tree).filter(node=>node.type==='form')).toHaveLength(1);
    expect(nodes(cards[0]).some(node=>node.type==='form')).toBe(false);
    expect(nodes(cards[1]).some(node=>node.type==='form')).toBe(true);
    expect(nodes(cards[1]).some(node=>node.props.children==='Second details')).toBe(false);
    expect(nodes(cards[1]).find(node=>node.type==='input'&&node.props.id==='task-subject')?.props.value).toBe('Second task');
    s.click(tree,'Cancel');expect(nodes(s.render()).filter(node=>node.type==='form')).toHaveLength(0);
    expect(nodes(s.render()).some(node=>node.props.children==='Second details')).toBe(true);
  });
  it('saves the existing task and collapses its card',async()=>{
    const s=screen();s.click(s.render(),'Edit Second task');const tree=s.render();
    const form=nodes(tree).find(node=>node.type==='form')!;
    (form.props.onSubmit as (event:unknown)=>void)({preventDefault:vi.fn()});await Promise.resolve();
    expect(mocks.save).toHaveBeenCalledWith({subject:'Second task',description:'Second details',dueDate:'2027-01-06'},'second');
    expect(nodes(s.render()).filter(node=>node.type==='form')).toHaveLength(0);
  });
  it('keeps failed edits inline and keeps new-task form outside the task cards',async()=>{
    mocks.save.mockResolvedValue(false);const s=screen();s.click(s.render(),'Edit First task');
    const form=nodes(s.render()).find(node=>node.type==='form')!;
    (form.props.onSubmit as (event:unknown)=>void)({preventDefault:vi.fn()});await Promise.resolve();
    expect(nodes(s.render()).find(node=>node.type==='article'&&node.key==='first')).toBeDefined();
    expect(nodes(s.render()).filter(node=>node.type==='form')).toHaveLength(1);
    s.click(s.render(),'Cancel');s.click(s.render(),'New task');const tree=s.render();
    expect(nodes(tree).filter(node=>node.type==='form')).toHaveLength(1);
    expect(nodes(tree).filter(node=>node.type==='article').every(card=>!nodes(card).some(node=>node.type==='form'))).toBe(true);
  });
});

describe('FireOps Assistant task drafts',()=>{
  it('opens the New task form filled with the drafted task once, without saving',()=>{
    const done=vi.fn();
    const frame=runtime.frame() as unknown as {slots:{effect?:()=>void}[];effects:Set<number>};
    const render=()=>{runtime.enter(frame as never);return TaskListPage({companyId:'company',user:{id:'user',name:'Alex',role:'owner'},onBack:vi.fn(),assistantRequest:{id:7,subject:'Grease E-4',description:'Front axle',dueDate:'2027-01-09'},onAssistantRequestDone:done})};
    const flush=()=>{for(const index of frame.effects)frame.slots[index].effect?.();frame.effects.clear()};
    render();flush();render();flush();
    const tree=render();
    const input=(id:string)=>nodes(tree).find(node=>(node.type==='input'||node.type==='textarea')&&node.props.id===id)?.props.value;
    expect(input('task-subject')).toBe('Grease E-4');
    expect(input('task-description')).toBe('Front axle');
    expect(input('task-due-date')).toBe('2027-01-09');
    expect(done).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
