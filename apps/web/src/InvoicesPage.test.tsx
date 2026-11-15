import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
vi.mock('./demo-uploads.css',()=>({}));
vi.mock('./InvoiceGenerator',()=>({InvoiceGenerator:()=>null}));
const calls=vi.hoisted(()=>({upserts:[] as Record<string,unknown>[],updates:[] as Record<string,unknown>[],uploads:[] as string[],autofill:vi.fn()}));
vi.mock('./receipt-autofill',()=>({
  loadReceiptAutofillEnabled:async()=>true,
  autofillImage:async()=>({image:'aGVsbG8=',mimeType:'image/jpeg'}),
  requestInvoiceAutofill:calls.autofill,
}));
vi.mock('./supabase',()=>{
  const customers=[{id:'srm',company_id:'c',name:'Sierra Resource Management',created_at:'',updated_at:''}];
  const row=(values:Record<string,unknown>)=>({created_by:'u1',created_by_name:'Crew',invoice_number:'',invoice_date:null,invoice_amount:0,customer_id:null,attachment:null,status:'draft',submitted_at:null,created_at:'2026-11-09T00:00:00Z',updated_at:'2026-11-09T00:00:00Z',...values});
  function query(table:string){
    let result:unknown={data:table==='invoice_customers'?customers:[],error:null};
    const chain:Record<string,unknown>={
      select:()=>chain,eq:()=>chain,order:()=>chain,
      upsert:(values:Record<string,unknown>)=>{calls.upserts.push(values);result={data:row(values),error:null};return chain},
      update:(values:Record<string,unknown>)=>{calls.updates.push(values);result={data:row(values),error:null};return chain},
      single:async()=>result,
      then:(resolve:(value:unknown)=>void)=>resolve(result),
    };
    return chain;
  }
  const channel={on:()=>channel,subscribe:()=>channel};
  return {supabase:{from:query,channel:()=>channel,removeChannel:async()=>undefined,storage:{from:()=>({upload:async(path:string)=>{calls.uploads.push(path);return {error:null}},remove:async()=>({error:null})})}}};
});
import type {FireOpsUser} from '@fireops/domain';
import {FileInput} from './demo-uploads';
import InvoicesPage from './InvoicesPage';

type Node={type:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
const text=(value:unknown):string=>Array.isArray(value)?value.map(text).join(''):typeof value==='string'||typeof value==='number'?String(value):value&&typeof value==='object'&&'props' in value?text((value as Node).props.children):'';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const crew={id:'u1',name:'Crew',email:'c@x',role:'fire_fighter'} as unknown as FireOpsUser;

function page(user=crew){
  const frame=runtime.frame() as ReturnType<typeof runtime.frame>&{slots:{effect?:()=>void}[];effects:Set<number>};
  const render=()=>{runtime.enter(frame);const tree=InvoicesPage({companyId:'c',user});for(const index of frame.effects)frame.slots[index].effect?.();frame.effects.clear();return tree};
  return {render};
}
const photo=new File([new Uint8Array([1,2,3])],'invoice.jpg',{type:'image/jpeg'});
async function scanFromForm(user=crew){
  const p=page(user);p.render();await flush();
  (nodes(p.render()).find(node=>node.type==='button'&&text(node.props.children)==='New Invoice')!.props.onClick as ()=>void)();
  for(let i=0;i<5;i++)await flush();
  const input=nodes(p.render()).find(node=>node.type===FileInput&&node.props.accept!==undefined&&!node.props['aria-label']);
  expect(input,'In-form scan picker').toBeDefined();
  (input!.props.onChange as (event:unknown)=>void)({target:{files:[photo],value:''}});
  for(let i=0;i<5;i++)await flush();
  return p;
}

beforeEach(()=>{calls.upserts.length=0;calls.updates.length=0;calls.uploads.length=0;calls.autofill.mockReset()});

describe('invoice photo auto-fill',()=>{
  it('has no Scan invoice button on the invoice list',async()=>{
    const p=page();p.render();await flush();
    expect(nodes(p.render()).some(node=>node.type===FileInput)).toBe(false);
  });

  it('fills a new draft from a scan, attaches the photo and never submits',async()=>{
    calls.autofill.mockResolvedValue({invoiceNumber:'INV-142',invoiceDate:'2026-10-30',dueDate:'2026-11-29',invoiceAmount:12480.5,customerName:'Sierra Resource Management, Inc.',confidence:{invoiceNumber:'high',invoiceDate:'high',dueDate:'high',invoiceAmount:'high',customerName:'high'}});
    const p=await scanFromForm();
    expect(calls.autofill).toHaveBeenCalledWith('c',{image:'aGVsbG8=',mimeType:'image/jpeg'});
    expect(calls.uploads).toHaveLength(1);
    expect(calls.upserts[calls.upserts.length-1]).toMatchObject({invoice_number:'INV-142',invoice_date:'2026-10-30',due_date:'2026-11-29',invoice_amount:12480.5,customer_id:'srm',status:'draft',attachment:{name:'invoice.jpg',mimeType:'image/jpeg'}});
    expect(calls.updates).toEqual([]);
    const tree=p.render();
    expect(nodes(tree).some(node=>node.props.className==='invoice-check-tag')).toBe(false);
    expect(nodes(tree).find(node=>node.type==='input'&&node.props.value==='INV-142')).toBeDefined();
  });

  it('highlights unsure fields and blocks submit until they are checked',async()=>{
    calls.autofill.mockResolvedValue({invoiceNumber:'INV-9',invoiceDate:'2026-10-30',invoiceAmount:300,customerName:'Sierra Resource Management',confidence:{invoiceNumber:'high',invoiceDate:'high',invoiceAmount:'medium',customerName:'high'}});
    const p=await scanFromForm();
    let tree=p.render();
    const tagged=nodes(tree).filter(node=>node.props.className==='invoice-field-check');
    expect(tagged.map(node=>text(node.props.children))).toEqual([expect.stringContaining('Invoice amountCheck')]);
    (nodes(tree).find(node=>node.type==='button'&&text(node.props.children)==='Submit Invoice')!.props.onClick as ()=>void)();
    await flush();
    tree=p.render();
    expect(text(nodes(tree).find(node=>node.props.role==='alert'))).toContain('Check the highlighted fields');
    expect(calls.updates).toEqual([]);
    (nodes(tree).find(node=>node.type==='button'&&text(node.props.children)==='They are correct')!.props.onClick as ()=>void)();
    (nodes(p.render()).find(node=>node.type==='button'&&text(node.props.children)==='Submit Invoice')!.props.onClick as ()=>void)();
    for(let i=0;i<3;i++)await flush();
    expect(calls.updates).toEqual([{status:'submitted'}]);
  });

  it('offers anyone filling the invoice to add a customer that is not in the list',async()=>{
    calls.autofill.mockResolvedValue({invoiceNumber:'A-1',customerName:'Pine Valley Fire District',confidence:{invoiceNumber:'high',customerName:'high'}});
    const tree=(await scanFromForm()).render();
    const prompt=nodes(tree).find(node=>node.props.className==='invoice-scan-customer');
    expect(text(prompt)).toContain('“Pine Valley Fire District” from the photo is not in your customer list.');
    expect(nodes(prompt).find(node=>node.type==='button'&&text(node.props.children)==='Add “Pine Valley Fire District”')).toBeDefined();
    expect(nodes(tree).find(node=>node.type==='option'&&node.props.value==='__add_customer__')).toBeDefined();
  });

  it('keeps the photo and lets the person type when auto-fill fails',async()=>{
    calls.autofill.mockRejectedValue(new Error('Daily auto-fill limit reached. Enter details by hand.'));
    const tree=(await scanFromForm()).render();
    expect(calls.uploads).toHaveLength(1);
    expect(text(nodes(tree).filter(node=>node.props.className==='invoice-scan-banner'))).toContain('Daily auto-fill limit reached');
  });
});
