import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import HotelsPage from './HotelsPage';
import TrainingPage from './TrainingPage';

const back='<button type="button" class="page-back">';
const noop=vi.fn();
const training=(onBack?:()=>void)=><TrainingPage trainings={[]} user={{id:'user',name:'Alex',role:'owner'}} onCreate={noop} onEdit={noop} onDelete={noop} onSignup={noop} onCancelSignup={noop} onViewed={noop} onBack={onBack}/>;

describe('page Back buttons',()=>{
  it('shows Back at the top of Training and Travel when a return page is given',()=>{
    for(const html of [renderToStaticMarkup(training(noop)),renderToStaticMarkup(<HotelsPage demoMode onBack={noop}/>)]){
      expect(html).toContain(back);
      expect(html.indexOf(back)).toBeLessThan(html.indexOf('<h1'));
    }
  });
  it('omits Back when no return page is given',()=>{
    expect(renderToStaticMarkup(training())).not.toContain(back);
    expect(renderToStaticMarkup(<HotelsPage demoMode/>)).not.toContain(back);
  });
});
