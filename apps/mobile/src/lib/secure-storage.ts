import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE=1800;
const MAX_CHUNKS=64;
const secureKey=(key:string)=>key.replace(/[^A-Za-z0-9._-]/g,'_');
const manifestKey=(key:string)=>`${secureKey(key)}.chunks`;
const chunkKey=(key:string,index:number)=>`${secureKey(key)}.${index}`;

async function storedChunkCount(key:string):Promise<number>{
  const value=await SecureStore.getItemAsync(manifestKey(key));
  const count=Number(value);
  return Number.isInteger(count)&&count>0&&count<=MAX_CHUNKS?count:0;
}

export const secureSessionStorage={
  async getItem(key:string):Promise<string|null>{
    const count=await storedChunkCount(key);
    if(count===0)return null;
    const chunks=await Promise.all(Array.from({length:count},(_,index)=>SecureStore.getItemAsync(chunkKey(key,index))));
    return chunks.every((chunk):chunk is string=>chunk!==null)?chunks.join(''):null;
  },
  async setItem(key:string,value:string):Promise<void>{
    const previousCount=await storedChunkCount(key);
    const chunks=value.match(new RegExp(`.{1,${CHUNK_SIZE}}`,'gs'))??[''];
    if(chunks.length>MAX_CHUNKS)throw new Error('Secure session exceeds storage limit.');
    await Promise.all(chunks.map((chunk,index)=>SecureStore.setItemAsync(chunkKey(key,index),chunk)));
    await SecureStore.setItemAsync(manifestKey(key),String(chunks.length));
    await Promise.all(Array.from({length:Math.max(0,previousCount-chunks.length)},(_,index)=>SecureStore.deleteItemAsync(chunkKey(key,chunks.length+index))));
  },
  async removeItem(key:string):Promise<void>{
    const count=await storedChunkCount(key);
    await Promise.all(Array.from({length:count},(_,index)=>SecureStore.deleteItemAsync(chunkKey(key,index))));
    await SecureStore.deleteItemAsync(manifestKey(key));
  },
};
