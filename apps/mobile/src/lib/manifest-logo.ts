import {File,Paths} from 'expo-file-system';

/** Embed the company logo in print HTML instead of relying on a signed URL. */
export async function manifestLogoDataUrl(url:string):Promise<string>{
  const response=await fetch(url);
  if(!response.ok)throw new Error('Company logo could not be loaded. Please try again.');
  const mime=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if(!mime?.startsWith('image/'))throw new Error('Company logo must be an image.');
  const file=new File(Paths.cache,`manifest-logo-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try{
    file.write(new Uint8Array(await response.arrayBuffer()));
    return `data:${mime};base64,${await file.base64()}`;
  }finally{
    if(file.exists)file.delete();
  }
}
