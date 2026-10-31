type ReceiptLike={id:string;amountCents:number;uploadedBy:string;createdAt:string};

// Same uploader, same amount, same local day: likely uploaded twice. Display hint only.
export function possibleDuplicateReceiptIds(receipts:readonly ReceiptLike[]):Set<string>{
  const groups=new Map<string,string[]>();
  for(const receipt of receipts){
    const date=new Date(receipt.createdAt);
    if(Number.isNaN(date.getTime()))continue;
    const key=`${receipt.uploadedBy}|${receipt.amountCents}|${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    groups.set(key,[...(groups.get(key)??[]),receipt.id]);
  }
  return new Set([...groups.values()].filter(ids=>ids.length>1).flat());
}
