import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createDemoNationalFireActivity} from '@fireops/domain';
import NationalFireActivitySection from './NationalFireActivitySection';

describe('shared demo reference data',()=>{
  it('has deterministic fire activity with consistent national totals',()=>{
    const activity=createDemoNationalFireActivity();
    expect(activity).toEqual(createDemoNationalFireActivity());
    expect(activity.areas).toHaveLength(10);
    for(const key of ['incidents','crews','engines','helicopters','totalPersonnel','cumulativeAcres'] as const){
      expect(activity.total[key]).toBe(activity.areas.reduce((sum,area)=>sum+area[key],0));
      expect(activity.total[key]).toBeGreaterThan(0);
    }
    activity.areas[0].incidents=999;
    expect(createDemoNationalFireActivity().areas[0].incidents).toBe(4);
  });

  it('renders fictional fire figures instead of a live-source claim in the web demo',()=>{
    const html=renderToStaticMarkup(<NationalFireActivitySection demoMode/>);
    expect(html).toContain('ONCC');
    expect(html).toContain('Fictional sample data');
    expect(html).not.toContain('Source PDF');
    expect(html).not.toContain('Data extracted from current');
    expect(html).not.toContain('Loading latest');
  });

  it('keeps live fire activity separate from demo fixtures',()=>{
    const html=renderToStaticMarkup(<NationalFireActivitySection/>);
    expect(html).toContain('Loading latest');
    expect(html).not.toContain('Fictional sample data');
  });
});
