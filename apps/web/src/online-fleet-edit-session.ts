import {fleetRecordsEqual} from './online-fleet-writes';
import type {FleetRemoteChange,FleetSnapshot,Vehicle} from '@fireops/domain';
export type SequencedFleetChange=FleetRemoteChange&{sequence:number};
export type OnlineFleetDraft={before:FleetSnapshot;after:FleetSnapshot};

/** Undo assignment intent only, never restore an old whole vehicle over newer independent fields. */
export function restoreFleetAssignment(current:Vehicle,previous:Vehicle,applied:Vehicle):Vehicle|null{
  const assignment=(value:Vehicle)=>({status:value.status,assignedTo:value.assignedTo,assignedFire:value.assignedFire});
  if(current.id!==previous.id||current.id!==applied.id||!fleetRecordsEqual(assignment(current),assignment(applied)))return null;
  return {...current,...assignment(previous)};
}

/** Memory-only web editing gate. Frozen retry payload; incoming server changes wait, not erase it. */
export function createOnlineFleetEditSession(){
  let base:FleetSnapshot|null=null;let draft:OnlineFleetDraft|null=null;let running:Promise<void>|null=null;
  const buffered=new Map<string,SequencedFleetChange>();
  return {
    get pending(){return base!==null},
    begin(before:FleetSnapshot){if(base)return false;base=before;return true},
    capture(after:FleetSnapshot):OnlineFleetDraft{
      if(!base)throw new Error('Fleet edit has no captured base.');
      if(!draft)draft={before:base,after:{vehicles:[...after.vehicles],issues:[...after.issues],crew:[...after.crew],activities:[...after.activities]}};
      return draft;
    },
    buffer(change:SequencedFleetChange){
      if(!base)return false;
      const id=change.event==='delete'?change.id:change.record.id;const key=`${change.collection}:${id}`;
      if((buffered.get(key)?.sequence??-1)<change.sequence)buffered.set(key,change);
      return true;
    },
    run(deliver:(draft:OnlineFleetDraft)=>Promise<void>):Promise<void>{
      if(running)return running;if(!draft)throw new Error('No captured fleet request.');
      const current=draft;const promise=Promise.resolve().then(()=>deliver(current));running=promise;
      const clear=()=>{if(running===promise)running=null};void promise.then(clear,clear);return promise;
    },
    finish(){base=null;draft=null;const changes=[...buffered.values()].sort((a,b)=>a.sequence-b.sequence);buffered.clear();return changes},
  };
}
