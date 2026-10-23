import {Directory,File,Paths} from 'expo-file-system';
import type {OutboxScope} from './offline-outbox';

/** Receipt files kept on the device until their receipt is created on the server (not app-encrypted, by decision). */
export type OfflineReceiptFiles={
  /** Copies the picked file before the receipt command is saved; returns its size. Re-keeping the same ID replaces the copy. */
  keep(receiptId:string,uri:string):Promise<number>;
  read(receiptId:string):Promise<ArrayBuffer|null>;
  /** Local file URI for viewing a receipt that has not synced yet. */
  uri(receiptId:string):string|null;
  remove(receiptId:string):void;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const offlineReceiptMaxBytes=10*1024*1024;
export function createNativeReceiptFiles(scope:OutboxScope):OfflineReceiptFiles{
  if(!uuid.test(scope.userId)||!uuid.test(scope.companyId))throw new Error('Invalid receipt storage scope.');
  const directory=new Directory(Paths.document,'fireops-offline-receipts-v1',scope.userId,scope.companyId);
  const file=(id:string)=>{if(!uuid.test(id))throw new Error('Invalid receipt.');return new File(directory,id)};
  return {
    async keep(id,uri){
      const source=new File(uri);if(!source.exists||source.size<=0||source.size>offlineReceiptMaxBytes)throw new Error('Receipt must be 10 MB or smaller.');
      directory.create({intermediates:true,idempotent:true});const target=file(id);if(target.exists)target.delete();source.copy(target);
      if(target.size!==source.size){target.delete();throw new Error('Receipt file could not be saved on this device.')}
      return target.size;
    },
    async read(id){const value=file(id);return value.exists?value.arrayBuffer():null},
    uri(id){const value=file(id);return value.exists?value.uri:null},
    remove(id){const value=file(id);if(value.exists)value.delete()},
  };
}
