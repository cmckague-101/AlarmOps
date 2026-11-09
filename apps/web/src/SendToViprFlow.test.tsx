import {describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
vi.mock('./SendToViprFlow.css',()=>({}));
import type {Vehicle} from '@fireops/domain';
import SendToViprFlow from './SendToViprFlow';

type Node={type:unknown;key?:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
const text=(value:unknown):string=>Array.isArray(value)?value.map(text).join(''):typeof value==='string'||typeof value==='number'?String(value):value&&typeof value==='object'&&'props' in value?text((value as Node).props.children):'';
const vehicles:Vehicle[]=[
  {id:'v1',unit:'Engine 701',type:'Type 3 Engine',year:2019,make:'International',model:'HV',vin:'1HTMMMML9KH483201',plate:'CA 8F701',status:'Ready',createdAt:'2025-02-04',pumpGpm:150,pumpPsi:250,tankGallons:500},
  {id:'v2',unit:'Tender 12',type:'Water Tender',year:2017,make:'Peterbilt',model:'367',vin:'',plate:'CA 8T012',status:'Assigned',createdAt:'2025-01-18'},
  {id:'v3',unit:'Dozer 4',type:'Dozer',year:2014,make:'Caterpillar',model:'D7R',vin:'CAT00D7RJLGP01234',plate:'',status:'Out of service',createdAt:'2024-12-11'},
];
function screen(){
  const frame=runtime.frame();const onClose=vi.fn();
  const render=()=>{runtime.enter(frame);return SendToViprFlow({vehicles,companyName:'North Ridge',onClose})};
  const button=(tree:unknown,label:string)=>{const found=nodes(tree).find(node=>node.type==='button'&&text(node.props.children).includes(label));expect(found,label).toBeDefined();return found!};
  return {render,onClose,button,click:(tree:unknown,label:string)=>(button(tree,label).props.onClick as ()=>void)()};
}

describe('Send to VIPR',()=>{
  it('preselects every in-service unit and blocks out-of-service ones',()=>{
    const s=screen();const tree=s.render();
    const boxes=nodes(tree).filter(node=>node.type==='input'&&node.props.type==='checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every(box=>box.props.checked)).toBe(true);
    expect(text(nodes(tree).find(node=>node.props.className==='send-vipr-blocked'))).toContain('Dozer 4 can’t be selected while Out of service');
    s.click(tree,'Clear');
    expect(s.button(s.render(),'Next: review fields').props.disabled).toBe(true);
  });
  it('reviews mapped fields per unit and builds a text bid package for the chosen units',()=>{
    const s=screen();
    (nodes(s.render()).find(node=>node.type==='input'&&node.props.type==='checkbox')!.props.onChange as ()=>void)();
    s.click(s.render(),'Next: review fields');
    let tree=s.render();
    expect(text(nodes(tree).find(node=>node.type==='h2'))).toBe('Tender 12 · Water Tender');
    const rows=nodes(tree).filter(node=>node.type==='tr').map(row=>text(row));
    expect(rows.some(row=>row.startsWith('VIN')&&row.endsWith('Missing'))).toBe(true);
    expect(text(tree)).not.toContain('VIPR Assist');
    s.click(tree,'Next: bid package');tree=s.render();
    const pre=text(nodes(tree).find(node=>node.type==='pre'));
    expect(pre).toContain('Company: North Ridge');
    expect(pre).toContain('=== Tender 12 · Water Tender ===');
    expect(pre).not.toContain('Engine 701');
    expect(s.button(tree,'Download .txt')).toBeDefined();
    s.click(tree,'Done');expect(s.onClose).toHaveBeenCalled();
  });
});
