import {describe,expect,it} from 'vitest';
import {createId} from './create-id';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createId',()=>{
  it('uses crypto.randomUUID when available',()=>{expect(createId()).toMatch(uuid)});
  it('builds a v4 UUID when randomUUID is unavailable on insecure origins',()=>{
    const original=Object.getOwnPropertyDescriptor(crypto,'randomUUID');
    Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined});
    try{const ids=new Set(Array.from({length:50},()=>createId()));expect(ids.size).toBe(50);ids.forEach(id=>expect(id).toMatch(uuid))}
    finally{if(original)Object.defineProperty(crypto,'randomUUID',original);else delete (crypto as {randomUUID?:unknown}).randomUUID}
  });
});
