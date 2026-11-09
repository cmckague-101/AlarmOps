import {describe,expect,it} from 'vitest';
import {applyReceiptAutofill,failReceiptAutofill,matchesReceiptFilter,newReceiptDraft,normalizeReceiptProject,receiptAmountToCents,receiptDraftProblems,receiptDraftReady,receiptProjects} from './receipts';

const today='2026-11-08';

describe('receipt amounts and projects',()=>{
  it('parses dollar text',()=>{
    expect(receiptAmountToCents('$1,234.5')).toBe(123450);
    expect(receiptAmountToCents('0')).toBeNull();
    expect(receiptAmountToCents('12.345')).toBeNull();
    expect(receiptAmountToCents('1000000.01')).toBeNull();
  });
  it('normalizes projects',()=>{
    expect(normalizeReceiptProject('  Pine   Valley  ')).toBe('Pine Valley');
    expect(normalizeReceiptProject('   ')).toBeUndefined();
    expect(normalizeReceiptProject('x'.repeat(130))).toHaveLength(120);
  });
});

describe('receipt drafts',()=>{
  it('needs merchant, amount and a past date when entered by hand, but no confirmation',()=>{
    const draft=newReceiptDraft('a',today,false);
    expect(receiptDraftProblems(draft,today)).toEqual({merchant:'Enter merchant.',amount:'Enter valid amount.'});
    const filled={...draft,merchant:'Fuel',amount:'45.99'};
    expect(receiptDraftReady(filled,today)).toBe(true);
    expect(receiptDraftProblems({...filled,purchasedOn:'2026-11-09'},today).purchasedOn).toBeDefined();
  });
  it('is not ready while auto-fill is reading',()=>{
    expect(receiptDraftReady({...newReceiptDraft('a',today,true),merchant:'Fuel',amount:'1'},today)).toBe(false);
  });
  it('trusts a high-confidence read of all three fields',()=>{
    const filled=applyReceiptAutofill(newReceiptDraft('a',today,true),{merchant:'Shell',purchasedOn:'2026-11-01',amountCents:4599,confidence:'high'},today);
    expect(filled).toMatchObject({status:'ready',merchant:'Shell',amount:'45.99',purchasedOn:'2026-11-01',autofilled:false,confidence:'high'});
    expect(receiptDraftReady(filled,today)).toBe(true);
  });
  it('requires the submitter to confirm a less certain or incomplete read',()=>{
    for(const result of [{merchant:'Shell',purchasedOn:'2026-11-01',amountCents:4599,confidence:'medium' as const},{merchant:'Shell',purchasedOn:null,amountCents:4599,confidence:'high' as const},{merchant:'Shell',purchasedOn:'2026-11-01',amountCents:4599}]){
      const filled=applyReceiptAutofill(newReceiptDraft('a',today,true),result,today);
      expect(filled).toMatchObject({autofilled:true,confirmed:false});
      expect(receiptDraftProblems(filled,today).confirm).toBe('Confirm auto-filled details.');
      expect(receiptDraftReady({...filled,confirmed:true},today)).toBe(true);
    }
  });
  it('keeps what the person typed while auto-fill was running',()=>{
    const typed={...newReceiptDraft('a',today,true),merchant:'My merchant',purchasedOn:'2026-10-30'};
    const filled=applyReceiptAutofill(typed,{merchant:'Shell',purchasedOn:'2026-11-01',amountCents:100},today);
    expect(filled).toMatchObject({merchant:'My merchant',purchasedOn:'2026-10-30',amount:'1.00',autofilled:true});
  });
  it('ignores future dates and explains unreadable photos',()=>{
    const unread=applyReceiptAutofill(newReceiptDraft('a',today,true),{merchant:null,purchasedOn:'2027-01-01',amountCents:null,confidence:'low'},today);
    expect(unread).toMatchObject({purchasedOn:today,autofilled:false,status:'ready'});
    expect(unread.note).toMatch(/could not read/);
    expect(receiptDraftProblems(unread,today).confirm).toBeUndefined();
    expect(applyReceiptAutofill(newReceiptDraft('a',today,true),{notReceipt:true},today).note).toMatch(/not look like a receipt/);
  });
  it('turns failures into manual entry',()=>{
    expect(failReceiptAutofill(newReceiptDraft('a',today,true),'Limit reached')).toMatchObject({status:'ready',note:'Limit reached',autofilled:false});
  });
});

describe('receipt list filters',()=>{
  const receipts=[{name:'Shell',project:'Pine Valley',fileName:'a.jpg',uploadedByName:'Sam'},{name:'Motel 6',project:'pine valley ',fileName:'b.pdf',uploadedByName:'Ana'},{name:'Cafe',project:null,fileName:'c.jpg',uploadedByName:'Sam'}];
  it('lists distinct projects',()=>{expect(receiptProjects([...receipts,{project:'Cedar Creek'}])).toEqual(['Cedar Creek','Pine Valley'])});
  it('filters by project and search terms',()=>{
    expect(receipts.filter(receipt=>matchesReceiptFilter(receipt,{project:'Pine Valley'}))).toHaveLength(2);
    expect(receipts.filter(receipt=>matchesReceiptFilter(receipt,{query:'sam pine'})).map(receipt=>receipt.name)).toEqual(['Shell']);
    expect(receipts.filter(receipt=>matchesReceiptFilter(receipt,{query:'valley',project:'Pine Valley'}))).toHaveLength(2);
    expect(receipts.filter(receipt=>matchesReceiptFilter(receipt,{}))).toHaveLength(3);
  });
});
