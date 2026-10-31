import {describe,expect,it} from 'vitest';
import {vinError} from './vin';

describe('vinError',()=>{
  it('allows an empty or valid VIN',()=>{expect(vinError('')).toBe('');expect(vinError(' 1hgcm82633a004352 ')).toBe('')});
  it('requires 17 characters',()=>{expect(vinError('1HGCM8263')).toContain('17 characters (9 entered)')});
  it('rejects I, O and Q',()=>{expect(vinError('1HGCM82633AO04352')).toContain('I, O or Q')});
  it('rejects other characters',()=>{expect(vinError('1HGCM82633A-04352')).toContain('letters and numbers')});
});
