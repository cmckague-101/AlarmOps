// Shared pool of bundled news-card photos. Web serves them from apps/web/public/news/<name>.jpg and
// mobile bundles apps/mobile/assets/news/<name>.jpg. To add a photo, put the JPG in both folders,
// add its name here, and add the matching require() in apps/mobile/src/components/news-feed-stories.tsx.
export const newsImageNames=[
  'airtanker-retardant-ridge',
  'crew-building-fireline',
  'crew-hose-line',
  'crew-on-the-line',
  'dousing-embers',
  'dozer-fireline-handtools',
  'dozer-line-crew',
  'engine-crew-hose',
  'engine-hose-mop-up',
  'firing-operation-dusk',
  'hand-crew-hiking',
  'helicopter-bucket-forest',
  'helicopter-bucket-ridge',
  'helicopter-bucket-slope',
  'helicopter-bucket-valley',
  'incident-briefing',
  'large-airtanker-drop',
  'mop-up-crew',
  'night-line-construction',
  'smokejumpers-burned-forest',
  'smokejumpers-landing',
] as const;

export type NewsImageName=typeof newsImageNames[number];

function hashKey(key:string){
  // FNV-1a: small, fast, and identical on every platform so web and mobile pick the same photo.
  let hash=0x811c9dc5;
  for(let index=0;index<key.length;index++){
    hash^=key.charCodeAt(index);
    hash=Math.imul(hash,0x01000193);
  }
  return hash>>>0;
}

/**
 * Picks a photo for each news item from its key (story id, headline, …). The same key always gets the
 * same photo, so images stay put across reloads and only change when the item itself changes. Items
 * that collide move to the next unused photo, so nothing repeats on screen until the pool runs out.
 * Earlier keys win collisions, so list the most stable items first.
 */
export function assignNewsImages(keys:readonly string[]):NewsImageName[];
export function assignNewsImages<T extends string>(keys:readonly string[],pool:readonly T[]):T[];
export function assignNewsImages(keys:readonly string[],pool:readonly string[]=newsImageNames):string[]{
  if(!pool.length)throw new Error('News image pool is empty.');
  const used=new Set<number>();
  return keys.map(key=>{
    let index=hashKey(key)%pool.length;
    if(used.size<pool.length){
      while(used.has(index))index=(index+1)%pool.length;
    }
    used.add(index);
    return pool[index];
  });
}
