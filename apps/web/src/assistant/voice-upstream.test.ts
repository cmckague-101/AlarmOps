import {it,expect} from 'vitest';
import {transcriptionUpload} from '../../../../supabase/functions/assistant-voice/upstream';

it('sends model and language before the file in the actual multipart wire body',async()=>{
 const audio=new File(['recorded bytes'],'question.audio',{type:'audio/webm;codecs=opus'});
 const form=transcriptionUpload(audio);
 expect([...form.keys()]).toEqual(['model','language','file']);
 const request=new Request('https://provider.invalid',{method:'POST',body:form});
 const wire=await request.clone().text();
 expect(wire.indexOf('name="model"')).toBeLessThan(wire.indexOf('name="file"'));
 expect(wire.indexOf('name="language"')).toBeLessThan(wire.indexOf('name="file"'));
 const parsed=await request.formData();
 expect(parsed.get('model')).toBe('grok-voice-transcribe-2.0');
 expect(parsed.get('language')).toBe('en');
 const file=parsed.get('file') as File;
 expect(file.name).toBe('question.webm');expect(file.type).toBe('audio/webm');
 expect(await file.text()).toBe('recorded bytes');
});

it.each([
 ['audio/webm;codecs=opus','webm'],['audio/mp4','mp4'],['audio/ogg','ogg'],
 ['audio/wav','wav'],['audio/x-wav','wav'],['audio/mpeg','mp3'],
])('normalizes %s to a supported filename without changing audio bytes',async(type,extension)=>{
 const input=new Uint8Array([0,255,37,18]);
 const file=transcriptionUpload(new Blob([input],{type})).get('file') as File;
 expect(file.name).toBe(`question.${extension}`);
 expect(new Uint8Array(await file.arrayBuffer())).toEqual(input);
});
