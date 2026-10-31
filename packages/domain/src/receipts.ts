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
