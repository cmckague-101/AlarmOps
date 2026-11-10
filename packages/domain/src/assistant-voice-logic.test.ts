import {describe,it,expect} from 'vitest';
import {claimFailure,validAudio,validText,MAX_AUDIO_BYTES} from '../../../supabase/functions/assistant-voice/logic';
describe('assistant voice validation and friendly access errors',()=>{
 it('rejects unsupported audio, oversized uploads and recordings over a minute',()=>{
  expect(validAudio('audio/webm;codecs=opus',100,59)).toBe(true);
  for(const [type,size,duration] of [['image/png',100,10],['audio/mp4',MAX_AUDIO_BYTES+1,10],['audio/ogg',100,61],['audio/wav',0,10],['audio/wav',100,NaN]] as const) expect(validAudio(type,size,duration)).toBe(false);
 });
 it('bounds spoken text',()=>{
  expect(validText('Hello')).toBe(true);expect(validText(' ')).toBe(false);expect(validText('a'.repeat(2001))).toBe(false);expect(validText({})).toBe(false);
 });
 it('fails closed when disabled and explains the daily limit',()=>{
  expect(claimFailure('disabled')).toMatchObject({status:403});expect(claimFailure(null)).toMatchObject({status:403});
  expect(claimFailure('limit')).toMatchObject({status:429,error:expect.stringContaining('Try again tomorrow')});expect(claimFailure('ok')).toBeNull();
 });
});
