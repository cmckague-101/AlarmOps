import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {createDeviceHistoryClient} from '@fireops/domain';
import {historySummary,historyReport,historyTarget} from '../../../packages/domain/test-fixtures/sync-device-history';
import {reviewCompany,reviewUser} from '../../../packages/domain/test-fixtures/sync-review';
import {SyncDeviceHistory} from './SyncDeviceHistory';
async function fixture(report=historyReport()){
  const transport={list:vi.fn().mockResolvedValue({items:[historySummary()],nextCursor:null}),report:vi.fn().mockResolvedValue(report)};
  const controller=createDeviceHistoryClient({companyId:reviewCompany,userId:reviewUser},transport);controller.start();controller.target(historyTarget);await controller.list();await controller.inspect(controller.getSnapshot().items[0]);return {controller,transport};
}
describe('web online history inspection (static markup only)',()=>{
  it('shows discarded values, chosen/downloaded values, authors and distinct reported/server times',async()=>{
    const f=await fixture();const html=renderToStaticMarkup(<SyncDeviceHistory controller={f.controller}/>);
    for(const text of ['Discarded saved value','Downloaded value','Local parent view','Alex','Original save (device-reported)','Local rebase (device-reported)','Server history received','phone-a','offline','not necessarily shared outcome','not canonical authorship or manager approvals'])expect(html).toContain(text);
    expect(html).not.toContain('type="radio"');expect(html).not.toContain('Approve selected values');
  });
  it('escapes device-reported text and full snapshots',async()=>{
    const report=historyReport();const entry=report.deviceHistory[0];if(entry.before.mutation.kind==='update')entry.before={...entry.before,mutation:{...entry.before.mutation,patch:{notes:{present:true,value:'<img src=x onerror=alert(1)>'}}}};
    const f=await fixture(report);const html=renderToStaticMarkup(<SyncDeviceHistory controller={f.controller}/>);expect(html).not.toContain('<img');expect(html).toContain('&lt;img');
  });
  it('does not call an absent history report proof that no original versions existed',async()=>{
    const f=await fixture();f.transport.list.mockResolvedValue({items:[],nextCursor:null});await f.controller.list();const html=renderToStaticMarkup(<SyncDeviceHistory controller={f.controller}/>);expect(html).toContain('does not prove that no earlier device versions existed');
  });
  it('clears sensitive displayed data when disposed',async()=>{
    const f=await fixture();f.controller.stop();const html=renderToStaticMarkup(<SyncDeviceHistory controller={f.controller}/>);expect(html).not.toContain('Discarded saved value');expect(html).not.toContain('Alex');
  });
});
