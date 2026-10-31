import {describe,expect,it} from 'vitest';
import {possibleDuplicateReceiptIds,receiptDate} from './receipts';

const receipt=(id:string,amountCents:number,uploadedBy:string,createdAt:string)=>({id,amountCents,uploadedBy,createdAt});

describe('possibleDuplicateReceiptIds',()=>{
  it('flags same uploader, amount and day',()=>{expect([...possibleDuplicateReceiptIds([receipt('a',45151,'u1','2026-10-27T15:00:00'),receipt('b',45151,'u1','2026-10-27T18:00:00'),receipt('c',49112,'u1','2026-10-27T18:00:00')])].sort()).toEqual(['a','b'])});
  it('ignores different uploaders or days',()=>{expect(possibleDuplicateReceiptIds([receipt('a',100,'u1','2026-10-27T10:00:00'),receipt('b',100,'u2','2026-10-27T10:00:00'),receipt('c',100,'u1','2026-10-28T10:00:00')]).size).toBe(0)});
  it('skips invalid dates',()=>{expect(possibleDuplicateReceiptIds([receipt('a',1,'u','soon'),receipt('b',1,'u','soon')]).size).toBe(0)});
  it('uses the purchase date when set',()=>{expect(possibleDuplicateReceiptIds([{...receipt('a',100,'u1','2026-10-27T10:00:00'),purchasedOn:'2026-10-20'},{...receipt('b',100,'u1','2026-10-27T11:00:00'),purchasedOn:'2026-10-21'}]).size).toBe(0)});
});

describe('receiptDate',()=>{
  it('prefers the purchase date and falls back to the upload day',()=>{expect(receiptDate({createdAt:'2026-10-27T10:00:00',purchasedOn:'2026-10-20'})).toBe('2026-10-20');expect(receiptDate({createdAt:'2026-10-27T10:00:00'})).toBe('2026-10-27');expect(receiptDate({createdAt:'soon'})).toBe('')});
});
