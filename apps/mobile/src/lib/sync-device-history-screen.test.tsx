import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {createDeviceHistoryClient} from '@fireops/domain';
import {historyReport,historySummary,historyTarget} from '../../../../packages/domain/test-fixtures/sync-device-history';
import {reviewCompany,reviewUser} from '../../../../packages/domain/test-fixtures/sync-review';
vi.mock('react-native',async()=>{const {createElement}=await import('react');const box=({children}:{children:unknown})=>createElement('div',{},children as never);return {View:box,Text:box,Pressable:box}});
vi.mock('../theme',()=>({useFireOpsTheme:()=>({ink:'#111',secondary:'#555',divider:'#aaa',danger:'#900'})}));
import {SyncDeviceHistory} from '../components/sync-device-history';
describe('native history content with stub components, no app/UI launch',()=>{
  it('shows preserved values and distinct timestamps without approval controls',async()=>{
    const controller=createDeviceHistoryClient({companyId:reviewCompany,userId:reviewUser},{list:vi.fn().mockResolvedValue({items:[historySummary()],nextCursor:null}),report:vi.fn().mockResolvedValue(historyReport())});controller.start();controller.target(historyTarget);await controller.list();await controller.inspect(controller.getSnapshot().items[0]);
    const html=renderToStaticMarkup(<SyncDeviceHistory controller={controller} offline={true}/>);
    for(const text of ['Discarded saved value','Downloaded value','Local parent view','Alex','Original save (device-reported)','Server history received','not necessarily shared outcome','Connect to inspect or refresh'])expect(html).toContain(text);
    expect(html).not.toContain('Approve selected values');controller.stop();
  });
});
