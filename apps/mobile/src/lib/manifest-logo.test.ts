import {afterEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({write:vi.fn(),base64:vi.fn(),delete:vi.fn()}));
vi.mock('expo-file-system',()=>({
  Paths:{cache:'file:///cache'},
  File:class {exists=true;write=mock.write;base64=mock.base64;delete=mock.delete},
}));
import {manifestLogoDataUrl} from './manifest-logo';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.resetAllMocks()});
describe('embedded manifest logo',()=>{
  it('embeds image bytes with their MIME type and removes the temporary file',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png; charset=binary'}})));
    mock.base64.mockResolvedValue('AQID');
    expect(await manifestLogoDataUrl('https://storage.example/logo')).toBe('data:image/png;base64,AQID');
    expect(mock.write).toHaveBeenCalledWith(new Uint8Array([1,2,3]));
    expect(mock.delete).toHaveBeenCalledOnce();
  });
  it('rejects failed downloads and non-image responses',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(new Response('error',{headers:{'content-type':'text/html'}}));
    vi.stubGlobal('fetch',fetch);
    await expect(manifestLogoDataUrl('https://storage.example/logo')).rejects.toThrow('could not be loaded');
    await expect(manifestLogoDataUrl('https://storage.example/logo')).rejects.toThrow('must be an image');
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('cleans up temporary files if encoding fails',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('image',{headers:{'content-type':'image/jpeg'}})));
    mock.base64.mockRejectedValue(new Error('Encoding failed'));
    await expect(manifestLogoDataUrl('https://storage.example/logo')).rejects.toThrow('Encoding failed');
    expect(mock.delete).toHaveBeenCalledOnce();
  });
});
