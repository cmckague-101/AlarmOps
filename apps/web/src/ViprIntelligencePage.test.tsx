import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ViprIntelligencePage} from './ViprIntelligencePage';

const labels=(html:string)=>[...html.matchAll(/<b>([^<]+)<\/b>/g)].map(match=>match[1]);

describe('VIPR Intelligence page',()=>{
  it('shows Send to VIPR and VIPR DPLs to owners and admins',()=>{
    for(const role of ['owner','admin'] as const){
      const html=renderToStaticMarkup(<ViprIntelligencePage role={role} onBack={vi.fn()} onOpen={vi.fn()}/>);
      expect(html).toContain('VIPR Intelligence');
      expect(html).toContain('Back');
      expect(labels(html)).toEqual(['Send to VIPR','VIPR DPLs']);
    }
  });
  it('hides Send to VIPR from crew roles and keeps VIPR DPLs',()=>{
    for(const role of ['fire_fighter','shop_tech','accounting','resource_boss'] as const){
      const html=renderToStaticMarkup(<ViprIntelligencePage role={role} onBack={vi.fn()} onOpen={vi.fn()}/>);
      expect(labels(html)).toEqual(['VIPR DPLs']);
      expect(html).not.toContain('Send to VIPR');
    }
  });
});
