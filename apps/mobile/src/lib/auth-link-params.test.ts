import {describe,expect,it} from 'vitest';
import {parseAuthLink} from './auth-link-params';

describe('parseAuthLink',()=>{
  it('reads PKCE authorization codes from query parameters',()=>{
    expect(parseAuthLink('fireops://reset-password?code=pkce-code')).toEqual({type:'code',code:'pkce-code'});
  });

  it('reads implicit-flow tokens from URL fragments',()=>{
    expect(parseAuthLink('fireops://reset-password#access_token=access&refresh_token=refresh&type=recovery')).toEqual({type:'tokens',accessToken:'access',refreshToken:'refresh'});
  });

  it('combines query and fragment parameters without corrupting either',()=>{
    expect(parseAuthLink('fireops://reset-password?type=recovery#access_token=access&refresh_token=refresh')).toEqual({type:'tokens',accessToken:'access',refreshToken:'refresh'});
  });

  it('rejects malformed or incomplete authentication links',()=>{
    expect(parseAuthLink('not a URL')).toBeNull();
    expect(parseAuthLink('fireops://reset-password#access_token=access')).toBeNull();
    expect(parseAuthLink('fireops://reset-password')).toBeNull();
  });
});
