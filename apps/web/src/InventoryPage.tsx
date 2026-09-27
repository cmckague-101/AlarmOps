import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CircleAlert, Minus, Package, Plus, RotateCcw, Search, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import { useDialogA11y } from './useDialogA11y';
import type {InventoryItem} from '@fireops/domain';
export type {InventoryItem} from '@fireops/domain';

type Props={
  canManage?:boolean;
  items:InventoryItem[];
  error?:string;
  currentUserId:string;
  onCreate:(name:string,quantity:number)=>Promise<InventoryItem>;
  onUpdate:(item:InventoryItem,quantity:number)=>Promise<InventoryItem>;
  onDelete:(item:InventoryItem)=>Promise<void>;
  onCheckout:(item:InventoryItem,quantity:number)=>Promise<void>;
  onCheckin:(item:InventoryItem,userId:string,quantity:number)=>Promise<void>;
};

export default function InventoryPage({canManage=true,items,error,currentUserId,onCreate,onUpdate,onDelete,onCheckout,onCheckin}:Props){
  const [query,setQuery]=useState('');
  const [formOpen,setFormOpen]=useState(false);
  const [deleting,setDeleting]=useState<InventoryItem>();
  const [rowError,setRowError]=useState('');
  const [busyId,setBusyId]=useState('');
  const filtered=useMemo(()=>items.filter(item=>item.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)),[items,query]);
  const updateQuantity=async(item:InventoryItem,quantity:number)=>{
    if(!Number.isInteger(quantity)||quantity<0||quantity>999999||quantity===item.quantity)return;
    setBusyId(item.id);setRowError('');
    try{await onUpdate(item,quantity)}catch(updateError){setRowError(updateError instanceof Error?updateError.message:'Quantity could not be updated. Check connection and try again.')}finally{setBusyId('')}
  };
  return <div className="page stock-page"><div className="page-heading stock-heading"><div><h1>Inventory</h1></div>{canManage&&<button className="primary" onClick={()=>setFormOpen(true)}><Plus/> Add item</button>}</div>
    {error&&<div className="communication-load-error" role="alert"><CircleAlert/><span>{error}</span></div>}
    {rowError&&<div className="communication-load-error" role="alert"><CircleAlert/><span>{rowError}</span></div>}
    <section className="stock-panel" aria-labelledby="stock-list-heading"><header><div><h2 id="stock-list-heading">Item list</h2><p>View company supplies and equipment.</p></div><label className="stock-search"><Search/><span className="sr-only">Search inventory</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search items"/>{query&&<button type="button" onClick={()=>setQuery('')} aria-label="Clear inventory search"><X/></button>}</label></header>
      <div className="stock-list">{filtered.map(item=>{const itemCheckedOut=item.checkouts.reduce((sum,checkout)=>sum+checkout.quantity,0);const available=item.quantity-itemCheckedOut;const own=item.checkouts.find(checkout=>checkout.userId===currentUserId);return <article className="stock-row stock-checkout-row" key={item.id}><span className="stock-item-icon"><Package/></span><div className="stock-item-copy"><h3>{item.name}</h3><small>{available} available · {itemCheckedOut} checked out · {item.quantity} total</small></div>{canManage?<><QuantityControl item={item} minimum={itemCheckedOut} busy={busyId===item.id} onUpdate={quantity=>updateQuantity(item,quantity)}/><button className="stock-delete" disabled={busyId===item.id||itemCheckedOut>0} onClick={()=>setDeleting(item)} aria-label={`Delete ${item.name}`} title={itemCheckedOut?'Check in all units before deleting':undefined}><Trash2/></button>{item.checkouts.length>0&&<div className="checkout-roster">{item.checkouts.map(checkout=><div key={checkout.userId}><span><UserRound/><b>{checkout.userName}</b><small>{checkout.quantity} checked out</small></span><ActionQuantity label={`Check in ${item.name} from ${checkout.userName}`} max={checkout.quantity} busy={busyId===item.id} action="Check in" icon={<RotateCcw/>} onSubmit={async quantity=>{setBusyId(item.id);setRowError('');try{await onCheckin(item,checkout.userId,quantity)}catch(checkinError){setRowError(checkinError instanceof Error?checkinError.message:'Item could not be checked in.')}finally{setBusyId('')}}}/></div>)}</div>}</>:<><div className="crew-stock-status"><b>{available} available</b>{own&&<small>You have {own.quantity}</small>}</div><ActionQuantity label={`Check out ${item.name}`} max={available} busy={busyId===item.id} action="Check out" icon={<ShoppingBag/>} onSubmit={async quantity=>{setBusyId(item.id);setRowError('');try{await onCheckout(item,quantity)}catch(checkoutError){setRowError(checkoutError instanceof Error?checkoutError.message:'Item could not be checked out.')}finally{setBusyId('')}}}/></>}</article>})}
        {!filtered.length&&<div className="empty stock-empty"><Package/><h3>{items.length?'No items found':'No inventory items'}</h3><p>{items.length?'Try another search.':'Add first item to begin tracking company stock.'}</p>{items.length&&<button className="secondary" onClick={()=>setQuery('')}>Clear search</button>}</div>}
      </div>
    </section>
    {formOpen&&<InventoryForm onClose={()=>setFormOpen(false)} onSave={async(name,quantity)=>{await onCreate(name,quantity);setFormOpen(false)}}/>}
    {deleting&&<DeleteInventoryDialog item={deleting} onCancel={()=>setDeleting(undefined)} onConfirm={async()=>{await onDelete(deleting);setDeleting(undefined)}}/>}
  </div>;
}

function ActionQuantity({label,max,busy,action,icon,onSubmit}:{label:string;max:number;busy:boolean;action:string;icon:React.ReactNode;onSubmit:(quantity:number)=>Promise<void>}){
  const [quantity,setQuantity]=useState('1');
  const valid=Number.isInteger(Number(quantity))&&Number(quantity)>=1&&Number(quantity)<=max;
  return <div className="checkout-action" aria-label={label}><input type="number" min="1" max={max} step="1" disabled={busy||max===0} value={quantity} onChange={event=>setQuantity(event.target.value)} aria-label="Quantity"/><button className="secondary" disabled={busy||!valid} onClick={()=>void onSubmit(Number(quantity))}>{icon} {busy?'Working…':action}</button></div>;
}

function QuantityControl({item,minimum,busy,onUpdate}:{item:InventoryItem;minimum:number;busy:boolean;onUpdate:(quantity:number)=>Promise<void>}){
  const [draft,setDraft]=useState(String(item.quantity));
  useEffect(()=>setDraft(String(item.quantity)),[item.quantity]);
  const commit=()=>{const value=Number(draft);if(Number.isInteger(value)&&value>=minimum&&value<=999999)void onUpdate(value);else setDraft(String(item.quantity))};
  return <div className="quantity-control" aria-label={`${item.name} total quantity`}><button disabled={busy||item.quantity===minimum} onClick={()=>void onUpdate(item.quantity-1)} aria-label={`Remove one ${item.name}`}><Minus/></button><input type="number" min={minimum} max="999999" step="1" disabled={busy} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();event.currentTarget.blur()}}} aria-label={`${item.name} quantity`}/><button disabled={busy||item.quantity===999999} onClick={()=>void onUpdate(item.quantity+1)} aria-label={`Add one ${item.name}`}><Plus/></button></div>;
}

function InventoryForm({onClose,onSave}:{onClose:()=>void;onSave:(name:string,quantity:number)=>Promise<void>}){
  const [name,setName]=useState('');const [quantity,setQuantity]=useState('0');const [errors,setErrors]=useState<Record<string,string>>({});const [submitError,setSubmitError]=useState('');const [busy,setBusy]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);const dialog=useDialogA11y(()=>{if(!busy)onClose()});
  const submit=async(event:React.FormEvent)=>{event.preventDefault();const next:Record<string,string>={};if(!name.trim())next.name='Item name is required';if(name.trim().length>160)next.name='Item name must be 160 characters or fewer';if(!Number.isInteger(Number(quantity))||Number(quantity)<0||Number(quantity)>999999)next.quantity='Quantity must be a whole number from 0 to 999,999';setErrors(next);setSubmitError('');if(Object.keys(next).length){formRef.current?.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus();return}setBusy(true);try{await onSave(name.trim(),Number(quantity))}catch(saveError){setSubmitError(saveError instanceof Error?saveError.message:'Item could not be added. Check connection and try again.');setBusy(false)}};
  return createPortal(<div className="overlay"><section ref={dialog.ref} className="drawer form-drawer stock-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-busy={busy} tabIndex={-1}><header><button className="back-mobile" disabled={busy} onClick={onClose}><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>Add inventory item</h2><p>Enter item name and current quantity.</p></div><button className="close" disabled={busy} onClick={onClose} aria-label="Close inventory form"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><fieldset><div className="form-grid"><label className={errors.name?'has-error':''}><span>Item name <b>*</b></span><input name="name" maxLength={160} autoFocus disabled={busy} value={name} onChange={event=>setName(event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name?'inventory-name-error':undefined}/>{errors.name&&<small id="inventory-name-error">{errors.name}</small>}</label><label className={errors.quantity?'has-error':''}><span>Starting quantity <b>*</b></span><input name="quantity" type="number" min="0" max="999999" step="1" disabled={busy} value={quantity} onChange={event=>setQuantity(event.target.value)} aria-invalid={Boolean(errors.quantity)} aria-describedby={errors.quantity?'inventory-quantity-error':undefined}/>{errors.quantity&&<small id="inventory-quantity-error">{errors.quantity}</small>}</label></div>{submitError&&<div className="form-submit-error" role="alert">{submitError}</div>}</fieldset><footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy?'Adding...':'Add item'}</button></footer></form></section></div>,document.body);
}

function DeleteInventoryDialog({item,onCancel,onConfirm}:{item:InventoryItem;onCancel:()=>void;onConfirm:()=>Promise<void>}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dialog=useDialogA11y(()=>{if(!busy)onCancel()});
  const remove=async()=>{setBusy(true);setError('');try{await onConfirm()}catch(deleteError){setError(deleteError instanceof Error?deleteError.message:'Item could not be deleted. Check connection and try again.');setBusy(false)}};
  return createPortal(<div className="overlay confirm-overlay"><section ref={dialog.ref} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-describedby={`${dialog.titleId}-description`} aria-busy={busy} tabIndex={-1}><span className="confirm-icon"><Trash2/></span><div><h2 id={dialog.titleId}>Delete {item.name}?</h2><p id={`${dialog.titleId}-description`}>This removes item and its current quantity from company inventory. This action cannot be undone.</p>{error&&<div className="confirm-error" role="alert">{error}</div>}</div><footer><button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="danger-button" disabled={busy} onClick={()=>void remove()}><Trash2/> {busy?'Deleting...':'Delete item'}</button></footer></section></div>,document.body);
}
