import {describe,expect,it} from 'vitest';
import type {SyncOperation} from '@fireops/domain';
import {decodeCanonicalSyncRecord,decodeSyncOutcome,decodeSyncReceipt,offlineSyncAdapterBlock} from './offline-sync-protocol';
const operation:SyncOperation={schemaVersion:1,operationId:'op-1',companyId:'company-1',entityType:'vehicle',entityId:'vehicle-1',provenance:{userId:'user-1',deviceId:'device',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:'1',base:{id:'vehicle-1',notes:'Old'},patch:{notes:{present:true,value:'New'}}}};
const time='2026-01-01T00:00:00Z';
const decision={kind:'reviewed',decisionId:'decision-1',conflictId:'conflict-1',operationId:'op-1',decidedAt:time,revision:'3',outcome:'kept',keptFields:['notes'],discardedFields:[]};
describe('native sync acknowledgment validation',()=>{
  it('validates receipt identity, type, time and decimal revisions before persistence',()=>{
    for(const value of [{kind:'unknown',receivedAt:time},{kind:'applied',receivedAt:'bad',revision:'2',record:{id:'vehicle-1'}},{kind:'applied',receivedAt:time,revision:2,record:{id:'vehicle-1'}},{kind:'applied',receivedAt:time,revision:'2',record:{id:'other'}}])expect(()=>decodeSyncReceipt(operation,value)).toThrow();
  });
  it('requires a fresh revision and distinguishes an explicit verified deletion from missing data',()=>{
    expect(()=>decodeCanonicalSyncRecord(operation,{revision:'1',record:{id:'vehicle-1'}},'2')).toThrow(/older/);
    expect(()=>decodeCanonicalSyncRecord(operation,{revision:'3'},'2')).toThrow();
    expect(decodeCanonicalSyncRecord(operation,{revision:'3',record:null},'2')).toEqual({revision:'3',record:null});
  });
  it('accepts no pending decision as null, but never accepts a mismatched or incomplete outcome',()=>{
    expect(decodeSyncOutcome(operation,'conflict-1',null)).toBeNull();expect(decodeSyncOutcome(operation,'conflict-1',decision)).toEqual(decision);
    for(const value of [{...decision,operationId:'other'},{...decision,conflictId:'other'},{...decision,keptFields:[]},{...decision,discardedFields:['notes']},{...decision,outcome:'not_selected'}])expect(()=>decodeSyncOutcome(operation,'conflict-1',value)).toThrow();
  });
  it('does not replay unsupported field/command/dependency workflows',()=>{
    expect(offlineSyncAdapterBlock(operation)).toBeNull();
    expect(offlineSyncAdapterBlock({...operation,dependsOn:['parent']})).toContain('rebase');
    expect(offlineSyncAdapterBlock({...operation,mutation:{kind:'command',command:'pay',payload:{}}})).toContain('not enabled');
    expect(offlineSyncAdapterBlock({...operation,entityType:'issue',mutation:{kind:'create',record:{id:'x'}}})).toBeNull();
    expect(offlineSyncAdapterBlock({...operation,entityType:'vehicle',mutation:{kind:'create',record:{id:'x'}}})).toBeNull();
    expect(offlineSyncAdapterBlock({...operation,entityType:'activity',mutation:{kind:'create',record:{id:'x'}}})).toContain('not enabled');
    expect(offlineSyncAdapterBlock({...operation,mutation:{kind:'update',baseRevision:'1',base:{},patch:{documents:{present:true,value:[]}}}})).toContain('dedicated offline adapter');
  });
});
