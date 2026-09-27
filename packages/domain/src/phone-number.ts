export function formatPhoneNumber(value:string){
  const digits=value.replace(/\D/g,'').slice(0,11);
  const local=digits.length===11&&digits.startsWith('1')?digits.slice(1):digits.slice(0,10);
  if(local.length<=3)return local;
  if(local.length<=6)return `${local.slice(0,3)}-${local.slice(3)}`;
  return `${local.slice(0,3)}-${local.slice(3,6)}-${local.slice(6)}`;
}
