import {Alert,Platform} from 'react-native';
import {getNativeOfflineOutbox} from './offline-outbox-native';

function confirm(message:string,failed=false):Promise<boolean>{
  return new Promise(resolve=>Alert.alert(failed?'Sync status unavailable':'Changes have not finished syncing',message,[
    {text:'Stay signed in',style:'cancel',onPress:()=>resolve(false)},
    {text:failed?'Sign out anyway':'Keep work & sign out',onPress:()=>resolve(true)},
  ],{cancelable:true,onDismiss:()=>resolve(false)}));
}
/** Explicit account-bound retention, never automatic deletion or a forced stay signed in. */
export async function prepareOfflineSyncSignOut(userId:string,isCurrent:()=>Promise<boolean>):Promise<boolean>{
  if(Platform.OS==='web')return true;
  const current=async()=>{try{return await isCurrent()}catch{return false}};
  if(!await current())return false;
  try{
    const store=await getNativeOfflineOutbox();
    const count=await store.countUnresolvedForUser(userId);
    if(!await current())return false;
    if(!count)return true;
    const accepted=await confirm(`${count} ${count===1?'item of retained work is':'items of retained work are'} waiting for upload, verification, review or attachment recovery. Signing out pauses syncing. Work will be kept on this device for this account; sign back in to continue. Changes not yet uploaded have no server backup.`);
    return accepted&&await current();
  }catch{
    if(!await current())return false;
    const accepted=await confirm('Sync status could not be checked. Saved work will not be deleted, but changes not yet uploaded may have no server backup. Sign out anyway?',true);
    return accepted&&await current();
  }
}
