import {describe,expect,it} from 'vitest';
import {demoUrl} from './demo-url';

describe('demo URL',()=>{
  it('links straight to the web demo instead of sign-in',()=>{
    expect(demoUrl('https://fireops.example')).toBe('https://fireops.example/?demo=1');
  });
  it('drops existing routes, queries, and anchors',()=>{
    expect(demoUrl('https://fireops.example/sign-in?info=1#pricing')).toBe('https://fireops.example/?demo=1');
  });
  it('supports local web development',()=>{
    expect(demoUrl('http://localhost:5173')).toBe('http://localhost:5173/?demo=1');
  });
  it('requires a configured website instead of guessing a hostname',()=>{
    expect(()=>demoUrl('')).toThrow('Demo is not configured.');
  });
  it('rejects non-web URLs',()=>{
    expect(()=>demoUrl('fireops://demo')).toThrow('Web URL must use HTTP or HTTPS.');
  });
});
