/** Build the provider's streaming multipart contract, independent of browser filenames. */
export function transcriptionUpload(file: Blob) {
 const type = file.type.split(';')[0].toLowerCase();
 const extensions: Record<string,string> = {
  'audio/webm':'webm','audio/mp4':'mp4','audio/ogg':'ogg',
  'audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3',
 };
 const upload = new FormData();
 upload.append('model','grok-voice-transcribe-2.0');
 upload.append('language','en');
 // xAI requires the file after all options. A real extension also avoids
 // forwarding the old web client's generic question.audio filename.
 upload.append('file',new Blob([file],{type}),`question.${extensions[type] ?? 'audio'}`);
 return upload;
}
