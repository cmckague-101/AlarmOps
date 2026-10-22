import {useState,useSyncExternalStore} from 'react';
import {Pressable,Text,View} from 'react-native';
import {deviceHistoryFields,deviceHistoryKey,deviceHistoryValueText,syncReviewFieldLabel,type DeviceHistoryClient} from '@fireops/domain';
import {useFireOpsTheme} from '../theme';
const date=(value:string)=>new Date(value).toLocaleString(undefined,{timeZoneName:'short'});
export function SyncDeviceHistory({controller,offline}:{controller:DeviceHistoryClient;offline:boolean}){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);const theme=useFireOpsTheme();const [raw,setRaw]=useState(false);
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:22};
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{minHeight:48,borderWidth:1,borderColor:theme.divider,borderRadius:10,padding:12,justifyContent:'center',opacity:disabled?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  if(!state.target)return null;
  return <View style={{gap:12,padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:14}}>
    <Text accessibilityRole="header" style={[body,{fontSize:20,fontWeight:'800'}]}>Device edit history (online)</Text>
    <Text style={meta}>Read-only device reports, not canonical authorship or manager approvals. Discarded values cannot be selected for approval. Device times/connectivity are reported; server times are separate.</Text>
    {offline&&<Text style={meta}>Connect to inspect or refresh. Any displayed report was loaded earlier.</Text>}
    {button(state.loading?'Loading history…':state.loaded?'Refresh history':'Load backed-up history',()=>void controller.list(),offline||state.loading)}
    {!!state.error&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{state.error}</Text>}
    {state.loaded&&!state.items.length&&<Text style={meta}>No backed-up device history is available. This does not prove that no earlier device versions existed.</Text>}
    {state.items.map(item=><View key={deviceHistoryKey(item)} style={{gap:8}}><Text selectable style={meta}>{item.actorName||item.actorUserId} · Server history received {date(item.receivedAt)} · Operation {item.operationId}</Text>{button(`Inspect device report · ${item.operationId.slice(-8)}`,()=>{setRaw(false);void controller.inspect(item)},offline||state.loading)}</View>)}
    {state.nextCursor&&button('Older reports',()=>void controller.list(true),offline||state.loading)}
    {state.reportLoading&&<Text accessibilityLiveRegion="polite" style={meta}>Loading device report…</Text>}
    {!!state.reportError&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{state.reportError}</Text>}
    {state.report&&<View style={{gap:12}}><Text accessibilityRole="header" style={[body,{fontWeight:'800'}]}>Device-reported versions</Text><Text selectable style={meta}>Authenticated submitter: {state.report.actorName||state.report.actorUserId} ({state.report.actorUserId}). Server history received: {date(state.report.receivedAt)}.</Text>
      {state.report.deviceHistory.map((entry,index)=><View key={index} style={{gap:10}}><Text style={body}>Local rebase {index+1} · {entry.reason.startsWith('explicit:')?'Explicit device choices':'Automatic independent merge'}</Text><Text selectable style={meta}>Original save (device-reported): {date(entry.before.provenance.savedAt)}. Local rebase (device-reported): {date(entry.createdAt)}. Connectivity (reported): {entry.before.provenance.connectivity}. Device: {entry.before.provenance.deviceId}.</Text>
        {deviceHistoryFields(entry).map(field=><View key={field.field} style={{gap:6}}><Text style={[body,{fontWeight:'700'}]}>{syncReviewFieldLabel(field.field)} · {field.choice}</Text><Text selectable style={body}>Local view when saved: {deviceHistoryValueText(field.before)}</Text><Text selectable style={body}>Saved proposal (retained even if discarded): {deviceHistoryValueText(field.saved)}</Text><Text selectable style={body}>Downloaded base used for rebase: {deviceHistoryValueText(field.downloaded)}</Text><Text selectable style={body}>Resulting submission, not necessarily shared outcome: {deviceHistoryValueText(field.submitted)}</Text></View>)}
        {button(raw?'Hide full device snapshots':'Show full device-reported snapshots',()=>setRaw(value=>!value))}
        {raw&&<Text selectable style={meta}>{JSON.stringify({before:entry.before,after:entry.after},null,2)}</Text>}
      </View>)}
    </View>}
  </View>;
}
