import {describe,expect,it} from 'vitest';
import {formatPhoneNumber} from '@fireops/domain';

describe('phone number formatting',()=>{
  it('adds dashes while a US phone number is entered',()=>{
    expect(formatPhoneNumber('5')).toBe('5');
    expect(formatPhoneNumber('5305')).toBe('530-5');
    expect(formatPhoneNumber('5305550100')).toBe('530-555-0100');
  });

  it('normalizes formatted and country-code phone numbers',()=>{
    expect(formatPhoneNumber('(530) 555-0100')).toBe('530-555-0100');
    expect(formatPhoneNumber('+1 530 555 0100')).toBe('530-555-0100');
  });
});
