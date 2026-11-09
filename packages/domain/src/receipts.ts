type ReceiptLike={id:string;amountCents:number;uploadedBy:string;createdAt:string;purchasedOn?:string|null};

/** Purchase date as YYYY-MM-DD; receipts saved before purchase dates existed use their upload day. */
export function receiptDate(receipt:Pick<ReceiptLike,'createdAt'|'purchasedOn'>):string{
  if(receipt.purchasedOn)return receipt.purchasedOn;
  const date=new Date(receipt.createdAt);
  return Number.isNaN(date.getTime())?'':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// Same uploader, same amount, same purchase day: likely uploaded twice. Display hint only.
export function possibleDuplicateReceiptIds(receipts:readonly ReceiptLike[]):Set<string>{
  const groups=new Map<string,string[]>();
  for(const receipt of receipts){
    const day=receiptDate(receipt);
    if(!day)continue;
    const key=`${receipt.uploadedBy}|${receipt.amountCents}|${day}`;
    groups.set(key,[...(groups.get(key)??[]),receipt.id]);
  }
  return new Set([...groups.values()].filter(ids=>ids.length>1).flat());
}

/** Most receipts one person can stage and submit together. */
export const MAX_RECEIPT_BATCH=25;
export const MAX_RECEIPT_PROJECT_LENGTH=120;

/** Dollar text ("$1,234.5") to cents, or null when it is not a positive amount up to $1,000,000. */
export function receiptAmountToCents(value:string):number|null{
  const normalized=value.trim().replace(/^\$/,'').replace(/,/g,'');
  if(!/^\d+(\.\d{1,2})?$/.test(normalized))return null;
  const [dollars,cents='']=normalized.split('.');
  const result=Number(dollars)*100+Number(cents.padEnd(2,'0'));
  return Number.isSafeInteger(result)&&result>0&&result<=100000000?result:null;
}

export const receiptCentsToInput=(cents:number)=>(cents/100).toFixed(2);

/** Trimmed project with inner whitespace collapsed; undefined when blank. */
export function normalizeReceiptProject(value:string|null|undefined):string|undefined{
  const text=(value??'').replace(/\s+/g,' ').trim().slice(0,MAX_RECEIPT_PROJECT_LENGTH).trim();
  return text||undefined;
}

export type ReceiptAutofillConfidence='high'|'medium'|'low';
/** Fields the receipt-autofill edge function returns; any may be missing. */
export type ReceiptAutofillResult={merchant?:string|null;purchasedOn?:string|null;amountCents?:number|null;confidence?:ReceiptAutofillConfidence|null;notReceipt?:boolean};

/** One staged receipt photo in a batch, before it is submitted. */
export type ReceiptDraft={
  key:string;
  /** `reading` while auto-fill is running for this photo. */
  status:'reading'|'ready';
  merchant:string;
  amount:string;
  purchasedOn:string;
  /** Auto-fill filled at least one field but was not sure of all three, so the submitter must confirm the card. */
  autofilled:boolean;
  confirmed:boolean;
  confidence:ReceiptAutofillConfidence|null;
  /** Auto-fill message for this card (failure or "not a receipt"). */
  note?:string;
};

export function newReceiptDraft(key:string,today:string,reading:boolean):ReceiptDraft{
  return {key,status:reading?'reading':'ready',merchant:'',amount:'',purchasedOn:today,autofilled:false,confirmed:false,confidence:null};
}

/**
 * Fill only fields the person has not typed into yet. A high-confidence read of
 * merchant, date and amount is trusted; anything less needs the submitter to confirm.
 */
export function applyReceiptAutofill<Draft extends ReceiptDraft>(draft:Draft,result:ReceiptAutofillResult,today:string):Draft{
  const merchant=!draft.merchant.trim()&&result.merchant?result.merchant.slice(0,160):draft.merchant;
  const amount=!draft.amount.trim()&&result.amountCents?receiptCentsToInput(result.amountCents):draft.amount;
  const purchasedOn=draft.purchasedOn===today&&result.purchasedOn&&/^\d{4}-\d{2}-\d{2}$/.test(result.purchasedOn)&&result.purchasedOn<=today?result.purchasedOn:draft.purchasedOn;
  const filled=merchant!==draft.merchant||amount!==draft.amount||purchasedOn!==draft.purchasedOn;
  const trusted=result.confidence==='high'&&!result.notReceipt&&Boolean(result.merchant&&result.amountCents&&result.purchasedOn&&result.purchasedOn<=today);
  return {...draft,status:'ready',merchant,amount,purchasedOn,autofilled:draft.autofilled||(filled&&!trusted),confirmed:false,
    confidence:result.confidence??null,note:result.notReceipt?'This photo does not look like a receipt. Check it or remove it.':filled?undefined:'Auto-fill could not read this receipt. Enter the details.'};
}

export function failReceiptAutofill<Draft extends ReceiptDraft>(draft:Draft,message:string):Draft{
  return {...draft,status:'ready',note:message};
}

export type ReceiptDraftProblems={merchant?:string;amount?:string;purchasedOn?:string;confirm?:string};
/** What still blocks this card from submitting. */
export function receiptDraftProblems(draft:ReceiptDraft,today:string):ReceiptDraftProblems{
  const problems:ReceiptDraftProblems={};
  if(!draft.merchant.trim())problems.merchant='Enter merchant.';
  else if(draft.merchant.trim().length>160)problems.merchant='Merchant is limited to 160 characters.';
  if(receiptAmountToCents(draft.amount)===null)problems.amount='Enter valid amount.';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.purchasedOn)||draft.purchasedOn<'2000-01-01'||draft.purchasedOn>today)problems.purchasedOn='Enter purchase date.';
  if(draft.autofilled&&!draft.confirmed)problems.confirm='Confirm auto-filled details.';
  return problems;
}

export const receiptDraftReady=(draft:ReceiptDraft,today:string)=>draft.status==='ready'&&Object.keys(receiptDraftProblems(draft,today)).length===0;

/** Distinct projects on these receipts, ignoring case, sorted by name. */
export function receiptProjects(receipts:readonly {project?:string|null}[]):string[]{
  const seen=new Map<string,string>();
  for(const receipt of receipts){const project=normalizeReceiptProject(receipt.project);if(project&&!seen.has(project.toLowerCase()))seen.set(project.toLowerCase(),project)}
  return [...seen.values()].sort((left,right)=>left.localeCompare(right,undefined,{sensitivity:'base'}));
}

/** Receipt list filter: `project` matches exactly (ignoring case), `query` searches name, project, file and uploader. */
export function matchesReceiptFilter(receipt:{name:string;project?:string|null;fileName?:string;uploadedByName?:string},filter:{project?:string;query?:string}):boolean{
  const project=normalizeReceiptProject(receipt.project)?.toLowerCase();
  if(filter.project&&project!==filter.project.toLowerCase())return false;
  const terms=(filter.query??'').toLowerCase().split(/\s+/).filter(Boolean);
  if(!terms.length)return true;
  const haystack=[receipt.name,receipt.project??'',receipt.fileName??'',receipt.uploadedByName??''].join(' ').toLowerCase();
  return terms.every(term=>haystack.includes(term));
}
