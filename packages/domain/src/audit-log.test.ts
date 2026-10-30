import {describe,expect,it} from 'vitest';
import {formatAuditDescription,formatAuditTimestamp} from './audit-log';

describe('audit log formatting',()=>{
  it('lowercases changed field names only',()=>{expect(formatAuditDescription('Updated crew record: Jacob Welsh (changed: joined At, status); status: Invited → Active')).toBe('Updated crew record: Jacob Welsh (changed: joined at, status); status: Invited → Active')});
  it('leaves descriptions without changed fields alone',()=>{expect(formatAuditDescription('Created crew availability: Micah Ciancia')).toBe('Created crew availability: Micah Ciancia')});
  it('formats timestamps with medium date and short time',()=>{const value='2026-10-30T21:23:04Z';expect(formatAuditTimestamp(value)).toBe(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)))});
  it('returns invalid timestamps unchanged',()=>{expect(formatAuditTimestamp('soon')).toBe('soon')});
});
