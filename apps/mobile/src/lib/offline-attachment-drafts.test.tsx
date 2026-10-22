import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {OfflineAttachmentController,AttachmentDraftState} from './offline-attachment-controller';
vi.mock('react-native',async()=>{const {createElement}=await import('react');const box=({children}:{children:unknown})=>createElement('div',{},children as never);return {View:box,Text:box,Pressable:({children,disabled}:{children:unknown;disabled:boolean})=>createElement('button',{disabled},children as never),Alert:{alert:vi.fn()}}});
vi.mock('expo-router',()=>({useFocusEffect:vi.fn()}));
vi.mock('expo-document-picker',()=>({getDocumentAsync:vi.fn()}));
vi.mock('../theme',()=>({useFireOpsTheme:()=>({ink:'#111',secondary:'#555',divider:'#aaa',danger:'#900'})}));
import {OfflineAttachmentDrafts} from '../components/offline-attachment-drafts';
const state:AttachmentDraftState={checking:false,checked:true,busyId:null,error:null,items:[{attachmentId:'40000000-0000-4000-8000-000000000001',userId:'user',companyId:'company',entityType:'vehicle',entityId:'vehicle',name:'<private-photo>.png',mimeType:'image/png',byteSize:5,sha256:'a'.repeat(64),deviceId:'phone',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline',state:'ready',error:null,operationIds:['operation']}]};
const controller={} as OfflineAttachmentController;
describe('native attachment draft inspection with stub components, no app/UI launch',()=>{
  it('shows device-only status/provenance, encryption warning and exact-byte recovery',()=>{
    const html=renderToStaticMarkup(<OfflineAttachmentDrafts controller={controller} state={state}/>);
    for(const text of ['Verified local copy — not uploaded','Original intent time (device-reported)','SHA-256','not encrypt','Restore exact original bytes','Referenced by','offline'])expect(html).toContain(text);expect(html).toContain('&lt;private-photo&gt;');expect(html).not.toContain('<private-photo>');expect(html).toMatch(/<button disabled="">.*?Discard unbound device copy/s);expect(html).not.toContain('Upload now');
  });
  it('never claims availability verified after a failed file check',()=>{
    const html=renderToStaticMarkup(<OfflineAttachmentDrafts controller={controller} state={{...state,checked:false,error:'Check failed'}}/>);expect(html).toContain('availability unconfirmed');expect(html).not.toContain('Verified local copy');
  });
});
