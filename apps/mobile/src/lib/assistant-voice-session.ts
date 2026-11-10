import {setAudioModeAsync} from 'expo-audio';
import * as Speech from 'expo-speech';
import {ExpoSpeechRecognitionModule as recognition} from 'expo-speech-recognition';

/** Device speech only; chat still uses the normal authenticated assistant endpoint. */
export async function listenOnce(signal:AbortSignal):Promise<string> {
  signal.throwIfAborted();
  if(!recognition.isRecognitionAvailable() || !recognition.supportsOnDeviceRecognition()) throw new Error('On-device speech is unavailable. You can still type.');
  const permission = await recognition.requestPermissionsAsync();
  signal.throwIfAborted();
  if(!permission.granted) throw new Error('Microphone and speech permission are required for voice. You can still type.');
  await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true,shouldPlayInBackground:false});
  signal.throwIfAborted();
  return new Promise<string>((resolve,reject)=>{
    let transcript='';let settled=false;
    const subscriptions:Array<{remove:()=>void}>=[];
    let timer:ReturnType<typeof setTimeout>;
    const finish=(error?:Error)=>{
      if(settled)return;settled=true;
      subscriptions.forEach(sub=>sub.remove());clearTimeout(timer);signal.removeEventListener('abort',abort);
      try{recognition.abort()}catch{/* Native session may already have ended. */}
      if(error)reject(error);else if(transcript)resolve(transcript);else reject(new Error('No speech detected. Tap Talk and try again.'));
    };
    const abort=()=>finish(new Error('Voice ended.'));
    subscriptions.push(recognition.addListener('result',event=>{
      transcript=event.results[0]?.transcript?.trim()||transcript;
      if(event.isFinal)finish();
    }),recognition.addListener('end',()=>finish()),recognition.addListener('error',event=>finish(new Error(event.message||'Speech recognition failed. You can still type.'))));
    signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(),60000);
    try{recognition.start({lang:'en-US',interimResults:true,continuous:false,requiresOnDeviceRecognition:true,addsPunctuation:true});}
    catch{finish(new Error('Could not start the microphone. You can still type.'));}
  });
}

export function finishListening(){recognition.stop();}
export async function releaseVoiceAudio(){
  try{recognition.abort()}catch{/* Native session may already have ended. */}
  await Speech.stop();
  await setAudioModeAsync({allowsRecording:false,shouldPlayInBackground:false});
}
export async function speakText(text:string,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true,shouldPlayInBackground:false});
  signal.throwIfAborted();
  return new Promise<void>((resolve,reject)=>{
    const cleanup=()=>signal.removeEventListener('abort',abort);
    const abort=()=>{cleanup();void Speech.stop();reject(new Error('Voice ended.'));};
    signal.addEventListener('abort',abort,{once:true});
    Speech.speak(text,{language:'en-US',onDone:()=>{cleanup();resolve();},onStopped:()=>{cleanup();resolve();},onError:()=>{cleanup();reject(new Error('Speech playback failed. Your reply is in the chat.'));}});
  });
}
