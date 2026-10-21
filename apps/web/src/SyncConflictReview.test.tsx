import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {createSyncReviewClient,syncReviewSetupMessage,type SyncReviewClientState} from '@fireops/domain';
import {reviewCandidate,reviewFixture} from '../../../packages/domain/test-fixtures/sync-review';
import {SyncConflictReview} from './SyncConflictReview';

function setup(patch:Partial<SyncReviewClientState>={}){
  const transport={list:vi.fn(),review:vi.fn(),approve:vi.fn()};
  const controller=createSyncReviewClient(null,transport,()=> 'request');
  const review=reviewFixture();
  const state:SyncReviewClientState={...controller.getSnapshot(),status:'ready',target:{entityType:'vehicle',entityId:review.entityId},review,...patch};
  return {transport,html:renderToStaticMarkup(<SyncConflictReview state={state} controller={controller} onBack={()=>{}}/>)};
}
describe('web conflict review markup',()=>{
  it('shows current/proposed/submitted-base values, authors and separate reported/server times',()=>{
    const {html,transport}=setup();
    for(const text of ['Online notes','Offline notes','Original notes','Morgan','Alex','Saved while offline','Connection status unknown','Device save time (reported)','Server received','Submitted verified base'])expect(html).toContain(text);
    expect(html).toContain('type="radio"');expect(html).toContain('type="checkbox"');expect(html).toContain('Choose a source for every field');
    expect(transport.approve).not.toHaveBeenCalled();
  });
  it('escapes record values rather than treating proposed content as HTML',()=>{
    const review=reviewFixture();const malicious='<img src=x onerror=alert(1)>';
    const changed={...review,fields:{notes:{...review.fields.notes,options:[{...review.fields.notes.options[0],value:{present:true as const,value:malicious}}]}}};
    const {html}=setup({review:changed});expect(html).not.toContain('<img');expect(html).toContain('&lt;img');
  });
  it('requires explicit confirmation even after selecting all field sources',()=>{
    const {html}=setup({choices:{notes:reviewCandidate}});
    expect(html).toMatch(/type="submit" disabled=""/);expect(html).toContain('Other proposed values will be discarded from active data');
  });
  it('offers an idempotent confirmation retry and disables navigation/selections while uncertain',()=>{
    const {html}=setup({choices:{notes:reviewCandidate},approval:'uncertain',reviewError:'Approval has not been confirmed.'});
    expect(html).toContain('Retry approval confirmation');expect(html).toMatch(/class="command-back" disabled=""/);expect(html).toContain('<fieldset disabled=""');
  });
  it('explains pending database setup instead of breaking the dashboard',()=>{
    const {html}=setup({review:null,reviewError:syncReviewSetupMessage});expect(html).toContain('pending sync migrations');expect(html).toContain('Refresh review');expect(html).not.toContain('Approve selected values');
  });
  it('makes deletion safety explicit and disables proposed restoration choices',()=>{
    const review=reviewFixture();
    const {html}=setup({review:{...review,currentRecord:null,fields:{notes:{...review.fields.notes,current:{present:false}}}}});
    expect(html).toContain('Keep record deleted');expect(html).toContain('restoring it requires a separate workflow');
    const proposed=html.match(new RegExp(`<input[^>]*value="${reviewCandidate}"[^>]*>`))?.[0];
    expect(proposed).toContain('disabled=""');
  });
});
