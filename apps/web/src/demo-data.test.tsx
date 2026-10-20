import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createDemoDispatchData,createDemoNationalFireActivity} from '@fireops/domain';
import NationalFireActivitySection from './NationalFireActivitySection';
import DispatchListsPage from './DispatchListsPage';

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

  it('preserves both existing web VIPR lists and rate-matching examples',()=>{
    const data=createDemoDispatchData();
    expect(data.lists.map(list=>list.file_id)).toEqual([1001,1002]);
    expect(data.entries['1001']).toHaveLength(4);
    expect(data.entries['1002']).toHaveLength(3);
    expect(data.entries['1001'][0]).toMatchObject({rank:1,daily_rate:2840,vin:'1HTMMMML9KH483201'});
    expect(data.entries['1002'][0]).toMatchObject({rank:1,daily_rate:3180,vin:'1XPTD4EX8HD397122'});
    expect(data.entries['1001'][3].rate_status).toBe('ambiguous');
    expect(data.entries['1002'][2].rate_status).toBe('not_found');
    data.entries['1001'].pop();
    expect(createDemoDispatchData().entries['1001']).toHaveLength(4);
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

  it('renders the existing VIPR demo from the shared fixtures',()=>{
    const html=renderToStaticMarkup(<DispatchListsPage demoMode/>);
    expect(html).toContain('North Ridge Wildfire');
    expect(html).toContain('2,840');
    expect(html).toContain('Demo data');
    expect(html).toContain('Not official VIPR data');
  });
});
