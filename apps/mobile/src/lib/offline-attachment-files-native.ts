import {Platform} from 'react-native';
import {Directory,File,FileMode,Paths} from 'expo-file-system';
import {deleteAsync} from 'expo-file-system/legacy';
import type {OfflineAttachmentFiles,AttachmentDigest} from './offline-attachment-vault';
import {attachmentId,offlineAttachmentMaxBytes} from './offline-attachment-types';
import type {OutboxScope} from './offline-outbox';

function normalizedFilePath(uri:string){
  const parsed=new URL(uri);if(parsed.protocol!=='file:'||parsed.host)throw new Error('A local picker file is required.');
  const parts:string[]=[];for(const part of decodeURIComponent(parsed.pathname).split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part)}return `/${parts.join('/')}`;
}
/** Native sandbox paths only. Original names/URIs never become managed paths. */
export function createNativeAttachmentFiles(scope:OutboxScope):OfflineAttachmentFiles{
  if(Platform.OS!=='ios'&&Platform.OS!=='android')throw new Error('Durable attachment storage is native-only.');
  attachmentId(scope.userId);attachmentId(scope.companyId);
  const root=new Directory(Paths.document,'fireops-offline-attachments-v1');const directory=new Directory(root,scope.userId,scope.companyId);
  const file=(id:string,slot:'part'|'blob')=>{attachmentId(id);return new File(directory,`${id}.${slot}`)};
  function picked(uri:string){
    if(typeof uri!=='string'||!(/^(file|content):\/\//.test(uri)))throw new Error('Select a local file; network URLs are not offline attachments.');
    if(uri.startsWith('file:')){const path=normalizedFilePath(uri);const managed=normalizedFilePath(root.uri);if(path===managed||path.startsWith(`${managed}/`))throw new Error('Managed files must be referenced through their owning account, not copied as picker files.')}
    return new File(uri);
  }
  async function fingerprint(source:File):Promise<AttachmentDigest>{
    const {CryptoDigestAlgorithm,digest}=await import('expo-crypto');
    if(!source.exists||source.size<=0||source.size>offlineAttachmentMaxBytes)throw new Error('Selected file is unavailable or exceeds 10 MB.');
    const handle=source.open(FileMode.ReadOnly);const chunks:Uint8Array[]=[];let length=0;
    try{for(;;){const bytes=await handle.readBytes(Math.min(64*1024,offlineAttachmentMaxBytes+1-length));if(!bytes.length)break;length+=bytes.length;if(length>offlineAttachmentMaxBytes)throw new Error('File grew beyond the device attachment limit.');chunks.push(bytes)}}finally{handle.close()}
    if(!length)throw new Error('Empty attachments are not supported.');const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    const hash=new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256,bytes));return {byteSize:length,sha256:Array.from(hash,value=>value.toString(16).padStart(2,'0')).join('')};
  }
  return {
    source:uri=>fingerprint(picked(uri)),
    async inspect(id,slot){const value=file(id,slot);return value.exists?fingerprint(value):null},
    async copy(uri,id,expectedBytes){
      if(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||expectedBytes>offlineAttachmentMaxBytes)throw new Error('Invalid copy byte limit.');
      directory.create({intermediates:true,idempotent:true});const reader=picked(uri).open(FileMode.ReadOnly);let writer:ReturnType<File['open']>|null=null;let written=0;
      try{
        const destination=file(id,'part');destination.create({overwrite:false});writer=destination.open(FileMode.WriteOnly);
        for(;;){const bytes=await reader.readBytes(Math.min(64*1024,expectedBytes+1-written));if(!bytes.length)break;written+=bytes.length;if(written>expectedBytes)throw new Error('Selected bytes changed while copying.');await writer.writeBytes(bytes)}
        if(written!==expectedBytes)throw new Error('Selected bytes changed while copying.');
      }finally{try{reader.close()}finally{writer?.close()}}
    },
    async promote(id){await file(id,'part').move(file(id,'blob'),{overwrite:false})},
    async remove(id,slot){await deleteAsync(file(id,slot).uri,{idempotent:true})},
    uri:id=>file(id,'blob').uri,
  };
}
