import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardPreferenceGroups,parseDashboardPreferences,type UserRole} from '@fireops/domain';
import {useDashboardPreferences} from './useDashboardPreferences';
import {DashboardCustomization} from './DashboardCustomization';
import {QuickActions} from './QuickActions';
import {OwnerDashboard} from './OwnerDashboard';

const ids=(role:UserRole,platform:'web'|'mobile')=>dashboardPreferenceGroups(role,platform).flatMap(group=>group.items.map(item=>item.id));
describe('dashboard customization',()=>{
  it('only accepts known boolean preferences and leaves missing items enabled',()=>{
    expect(parseDashboardPreferences({greeting:false,incidents:true,payroll:'false',unknown:false})).toEqual({greeting:false,incidents:true});
    for(const value of [null,[],false,'invalid'])expect(parseDashboardPreferences(value)).toEqual({});
  });
  it.each(['web','mobile'] as const)('keeps settings role appropriate on %s',platform=>{
    expect(ids('owner',platform)).toEqual(ids('admin',platform));
    expect(ids('owner',platform)).toContain('incidents');
    expect(ids('owner',platform)).not.toContain('currentIssues');
    expect(ids('owner',platform)).not.toContain('recentActivity');
    expect(ids('shop_tech',platform)).toEqual(expect.arrayContaining(['currentIssues','tasks','inspections','recentActivity']));
    expect(ids('fire_fighter',platform)).not.toContain('tasks');
    expect(ids('fire_fighter',platform)).not.toContain('inspections');
    expect(ids('fire_fighter',platform)).not.toContain('resources');
    for(const role of ['owner','admin','shop_tech','fire_fighter'] as const){
      const keys=ids(role,platform);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toEqual(expect.arrayContaining(['greeting','availability','inventory','payroll','receipts','invoices','nationalFireActivity']));
    }
  });
  it('updates subscribers by user, preserves unrelated choices, and supports re-enabling',async()=>{
    let preferences:ReturnType<typeof useDashboardPreferences>;
    function Probe({id}:{id:string}){preferences=useDashboardPreferences(id,true);return null}
    const render=(id:string)=>renderToStaticMarkup(<Probe id={id}/>);
    render('customization-test-user');
    expect(preferences!.visible('greeting')).toBe(true);
    await preferences!.save('greeting',false);
    render('customization-test-user');
    expect(preferences!.visible('greeting')).toBe(false);
    await preferences!.save('payroll',false);
    render('other-customization-test-user');
    expect(preferences!.visible('greeting')).toBe(true);
    expect(preferences!.visible('payroll')).toBe(true);
    render('customization-test-user');
    expect(preferences!.visible('greeting')).toBe(false);
    expect(preferences!.visible('payroll')).toBe(false);
    await preferences!.save('greeting',true);
    render('customization-test-user');
    expect(preferences!.visible('greeting')).toBe(true);
    expect(preferences!.visible('payroll')).toBe(false);
  });
  it('hides selected cards and quick actions without hiding the customize button',async()=>{
    let preferences:ReturnType<typeof useDashboardPreferences>;
    function Probe(){preferences=useDashboardPreferences('visibility-test',true);return null}
    renderToStaticMarkup(<Probe/>);
    for(const id of ['incidents','personnel','resources','attention','availability','tasks','inventory','payroll','receipts','invoices'] as const)await preferences!.save(id,false);
    renderToStaticMarkup(<Probe/>);
    const dashboard=renderToStaticMarkup(<OwnerDashboard preferences={preferences!} onCustomize={()=>{}} name="Alex" vehicles={[]} crew={[]} issues={[]} onSelect={()=>{}}/>);
    expect(dashboard).not.toContain('Active Incidents');
    expect(dashboard).not.toContain('Assigned Personnel');
    expect(dashboard).not.toContain('Assigned Resources');
    expect(dashboard).not.toContain('Needs Attention');
    expect(dashboard).toContain('Customize Dashboard');
    const actions=()=>renderToStaticMarkup(<QuickActions demoMode user={{id:'visibility-test',name:'Alex',role:'shop_tech'}} onOpen={()=>{}} onInspect={()=>{}}/>);
    expect(actions()).toContain('Inspect');
    expect(actions()).not.toContain('Availability');
    expect(actions()).not.toContain('Task List');
    await preferences!.save('inspections',false);
    expect(actions()).toBe('');
  });
  it('renders grouped, accessible switches for each user',()=>{
    const html=renderToStaticMarkup(<DashboardCustomization userId="render-test" role="shop_tech" demoMode/>);
    expect(html).toContain('Command Center');
    expect(html).toContain('Quick Actions');
    expect(html).toContain('Recent Fleet Activity');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Current issues');
    expect(html).not.toContain('Active Incidents');
  });
});
