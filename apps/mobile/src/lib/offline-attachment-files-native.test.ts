import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({platform:{OS:'ios'},data:new Map<string,Uint8Array>(),close:vi.fn(),digest:vi.fn()}));
vi.mock('react-native',()=>({Platform:mocks.platform}));
vi.mock('expo-file-system',()=>{
  const uri=(parts:any[])=>{const [first,...rest]=parts.map(value=>typeof value==='string'?value:value.uri);return rest.length?`${first.replace(/\/+$/,'')}/${rest.map(value=>value.replace(/^\/+|\/+$/g,'')).join('/')}`:first};
  class Directory{uri:string;constructor(...parts:any[]){this.uri=uri(parts)}create(){}}
  class File{uri:string;constructor(...parts:any[]){this.uri=uri(parts)}get exists(){return mocks.data.has(this.uri)}get size(){return mocks.data.get(this.uri)?.length??0}create(){if(this.exists)throw new Error('exists');mocks.data.set(this.uri,new Uint8Array())}open(_mode?:string){let offset=0;const bytes=mocks.data.get(this.uri)!;return {readBytes:(size:number)=>{const next=bytes.slice(offset,offset+size);offset+=next.length;return next},writeBytes:(value:Uint8Array)=>{const previous=mocks.data.get(this.uri)!;const next=new Uint8Array(previous.length+value.length);next.set(previous);next.set(value,previous.length);mocks.data.set(this.uri,next)},close:mocks.close}}async copy(to:File){if(to.exists)throw new Error('exists');mocks.data.set(to.uri,mocks.data.get(this.uri)!.slice())}async move(to:File){if(to.exists)throw new Error('exists');mocks.data.set(to.uri,mocks.data.get(this.uri)!);mocks.data.delete(this.uri)}}
  return {Directory,File,FileMode:{ReadOnly:'r',WriteOnly:'w'},Paths:{document:{uri:'file:///documents'}}};
});
vi.mock('expo-file-system/legacy',()=>({deleteAsync:async(uri:string)=>{mocks.data.delete(uri)}}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA-256'},digest:mocks.digest}));
import {createNativeAttachmentFiles} from './offline-attachment-files-native';
const scope={userId:'20000000-0000-4000-8000-000000000001',companyId:'10000000-0000-4000-8000-000000000001'};const id='40000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.clearAllMocks();mocks.platform.OS='ios';mocks.data.clear();mocks.digest.mockImplementation(async(_algorithm,bytes)=>new Uint8Array(createHash('sha256').update(bytes).digest()).buffer)});
describe('native managed attachment file boundary',()=>{
  it('uses document storage, opaque scoped names and real byte SHA-256 with bounded file handles',async()=>{
    const files=createNativeAttachmentFiles(scope);const bytes=new Uint8Array([0,255,1]);mocks.data.set('file:///picker/file.tmp',bytes);expect(await files.source('file:///picker/file.tmp')).toEqual({byteSize:3,sha256:createHash('sha256').update(bytes).digest('hex')});expect(mocks.close).toHaveBeenCalledOnce();expect(mocks.digest).toHaveBeenCalledWith('SHA-256',bytes);
    await files.copy('file:///picker/file.tmp',id,3);await files.promote(id);expect(files.uri(id)).toBe(`file:///documents/fireops-offline-attachments-v1/${scope.userId}/${scope.companyId}/${id}.blob`);expect((await files.inspect(id,'blob'))?.byteSize).toBe(3);await files.remove(id,'blob');expect(await files.inspect(id,'blob')).toBeNull();expect(mocks.data.has('file:///picker/file.tmp')).toBe(true);
  });
  it('refuses web, unsafe identities, remote URLs and direct managed-file borrowing',async()=>{
    mocks.platform.OS='web';expect(()=>createNativeAttachmentFiles(scope)).toThrow('native-only');mocks.platform.OS='android';expect(()=>createNativeAttachmentFiles({...scope,userId:'../other'})).toThrow('identity');const files=createNativeAttachmentFiles(scope);
    for(const uri of ['https://example.com/file','file://remote-host/secret',`file:///documents/fireops-offline-attachments-v1/other/company/${id}.blob`,`file:///documents/fireops-offline-attachments-v1%2Fother%2F${id}.blob`])expect(()=>files.source(uri)).toThrow();expect(mocks.digest).not.toHaveBeenCalled();
  });
  it('caps copies at the reserved byte count even when a picker source grows',async()=>{
    const files=createNativeAttachmentFiles(scope);mocks.data.set('file:///picker/changed',new Uint8Array([1,2,3]));await expect(files.copy('file:///picker/changed',id,2)).rejects.toThrow('changed');
    expect(mocks.data.get(files.uri(id).replace('.blob','.part'))?.length).toBe(0);expect(mocks.close).toHaveBeenCalledTimes(2);
  });
  it('rejects empty or oversized sources before reading or hashing',async()=>{
    const files=createNativeAttachmentFiles(scope);mocks.data.set('file:///picker/empty',new Uint8Array());mocks.data.set('file:///picker/big',new Uint8Array(10*1024*1024+1));await expect(files.source('file:///picker/empty')).rejects.toThrow('unavailable');await expect(files.source('file:///picker/big')).rejects.toThrow('10 MB');expect(mocks.digest).not.toHaveBeenCalled();expect(mocks.close).not.toHaveBeenCalled();
  });
});
