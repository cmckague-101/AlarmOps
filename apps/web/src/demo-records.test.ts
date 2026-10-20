import {describe,expect,it} from 'vitest';
import {payrollCrewIds,payrollTotals,type FireOpsUser} from '@fireops/domain';
import {createDemoRecords,demoQualifications} from './demo-records';

const user:FireOpsUser={id:'u1',name:'Ryan Mitchell',role:'owner'};

describe('session-only demo records',()=>{
  it('provides two submitted invoices with matching fictional customers',()=>{
    const data=createDemoRecords(user,new Date('2028-01-01T12:00:00Z'));
    expect(data.invoices).toHaveLength(2);
    for(const invoice of data.invoices){
      expect(invoice.status).toBe('submitted');
      expect(invoice.invoiceAmount).toBeGreaterThan(0);
      expect(invoice.invoiceNumber).toContain('DEMO-2028');
      expect(data.customers.find(customer=>customer.id===invoice.customerId)?.name).toContain('(Demo)');
      expect(invoice.createdBy).toBe(user.id);
    }
  });

  it('provides current-year payroll with populated crew, hours, and approval examples',()=>{
    const {payroll}=createDemoRecords(user,new Date('2028-01-01T12:00:00Z'));
    expect(payroll.map(form=>form.status)).toEqual(['pending','approved']);
    for(const form of payroll){
      expect(new Date(form.createdAt).getFullYear()).toBe(2028);
      expect(form.rows).toHaveLength(21);
      expect(form.rows.every(row=>row.date.startsWith('2028-'))).toBe(true);
      expect(payrollCrewIds(form.rows)).toEqual(['u2']);
      expect(payrollTotals(form.rows).totalHours).toBeGreaterThan(0);
      expect(payrollTotals(form.rows).overtimeHours).toBeGreaterThan(0);
    }
    expect(payroll[1].approvedBy).toBe(user.id);
  });

  it('populates every master-record section, including annual dates and incident experience',()=>{
    const record=demoQualifications(2028);
    for(const type of ['Qualification','Task Book','Training','License','DOT Medical']){
      expect(record.credentials?.some(credential=>credential.recordType===type)).toBe(true);
    }
    expect(record.credentials?.some(credential=>!credential.recordType)).toBe(true);
    expect(record.experiences).toHaveLength(2);
    expect(record.annualRecord?.rt130CompletionDate).toBe('2028-03-10');
    expect(record.annualRecord?.wctCurrencyDate).toBe('2029-03-10');
  });

  it('populates training, inventory, failed inspections, and recent audit activity',()=>{
    const now=new Date('2028-04-10T12:00:00Z');
    const data=createDemoRecords(user,now);
    expect(data.trainings).toHaveLength(1);
    expect(Date.parse(data.trainings[0].date)).toBeGreaterThan(now.getTime());
    expect(data.inventory).toHaveLength(4);
    expect(data.inventory.every(item=>item.quantity>0)).toBe(true);
    expect(data.inventory[0].checkouts[0].quantity).toBe(2);
    expect(data.inspections).toHaveLength(2);
    expect(data.inspections.every(inspection=>inspection.items.some(item=>item.result==='Fail'&&item.defectNotes))).toBe(true);
    expect(data.auditLogs.length).toBeGreaterThan(2);
    expect(data.auditLogs.every(entry=>Date.parse(entry.created_at)<=now.getTime()&&Date.parse(entry.created_at)>now.getTime()-30*86400000)).toBe(true);
  });

  it('provides two fictional crew conversations with recent, chronological replies',()=>{
    const now=new Date('2028-04-10T12:00:00Z');
    const {threads}=createDemoRecords(user,now);
    expect(threads).toHaveLength(2);
    expect(new Set(threads.map(thread=>thread.subject)).size).toBe(2);
    const ids:string[]=[];
    for(const thread of threads){
      ids.push(thread.id);
      expect(thread.createdById).toBe(user.id);
      expect(thread.description.toLowerCase()).toContain('demo');
      expect(thread.replies).toHaveLength(2);
      let previous=Date.parse(thread.createdAt);
      for(const reply of thread.replies){
        ids.push(reply.id);
        expect(reply.body).not.toBe('');
        expect(reply.createdById).not.toBe(user.id);
        expect(Date.parse(reply.createdAt)).toBeGreaterThan(previous);
        expect(Date.parse(reply.createdAt)).toBeLessThanOrEqual(now.getTime());
        previous=Date.parse(reply.createdAt);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates fresh data when a new demo session starts',()=>{
    const first=createDemoRecords(user);
    first.invoices.splice(0);
    first.threads[0].replies.splice(0);
    first.payroll[0].rows[0].hoursWorked=0;
    const next=createDemoRecords(user);
    expect(next.invoices).toHaveLength(2);
    expect(next.threads[0].replies).toHaveLength(2);
    expect(next.payroll[0].rows[0].hoursWorked).toBe(12);
  });
});
