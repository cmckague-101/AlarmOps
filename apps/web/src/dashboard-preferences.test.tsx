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
      expect(keys).toEqual(expect.arrayContaining(['greeting','availability','payroll','invoices']));
      // National Fire Activity lives on News Feed now, so it has no Dashboard switch.
      expect(keys).not.toContain('nationalFireActivity');
      // The Operations map always shows, so there is no Incident map switch.
      expect(keys).not.toContain('incidentMap');
      expect(keys).not.toContain('receipts');
    }
    // Inventory stays a Quick Action only for the roles that keep it in main navigation.
    expect(ids('shop_tech',platform)).toContain('inventory');
    expect(ids('resource_boss',platform)).toContain('inventory');
    for(const role of ['owner','admin','fire_fighter','accounting'] as const)expect(ids(role,platform)).not.toContain('inventory');
    // Managers no longer get a Failed Inspections tile on the dashboard.
    expect(ids('fire_fighter',platform)).not.toContain('shop');
    expect(ids('owner',platform)).not.toContain('inspections');
  });
  it('offers current picture only on mobile and recent fleet activity for both member roles',()=>{
    expect(parseDashboardPreferences({currentPicture:false,recentActivity:false})).toEqual({currentPicture:false,recentActivity:false});
    for(const role of ['shop_tech','fire_fighter'] as const){
      expect(ids(role,'mobile')).toEqual(expect.arrayContaining(['currentPicture','recentActivity']));
      expect(ids(role,'web')).not.toContain('currentPicture');
      const command=dashboardPreferenceGroups(role,'mobile').find(group=>group.title==='Command Center');
      expect(command?.items).toContainEqual({id:'currentPicture',label:'Current picture — vehicles needing attention'});
    }
    expect(ids('owner','mobile')).not.toContain('currentPicture');
    expect(ids('admin','mobile')).not.toContain('currentPicture');
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
    for(const id of ['incidents','personnel','resources','attention','availability','tasks','inventory','payroll','invoices'] as const)await preferences!.save(id,false);
    renderToStaticMarkup(<Probe/>);
    const dashboard=renderToStaticMarkup(<OwnerDashboard canProcessPayroll preferences={preferences!} onCustomize={()=>{}} name="Alex" vehicles={[]} crew={[]} issues={[]} onSelect={()=>{}}/>);
    expect(dashboard).not.toContain('Active Incidents');
    expect(dashboard).not.toContain('Assigned Personnel');
    expect(dashboard).not.toContain('Assigned Resources');
    expect(dashboard).not.toContain('Needs Attention');
    expect(dashboard).toContain('Customize Operations');
    expect(dashboard).not.toContain('Customize Dashboard');
    // Not demo mode: the greeting card shows a time-of-day hello and the first name, like the phone.
    expect(dashboard).toMatch(/<div class="command-greeting"><span class="command-greeting-hello">Good (Morning|Afternoon|Evening),<\/span><span class="command-greeting-name">Alex!<\/span><\/div>/);
    const actions=()=>renderToStaticMarkup(<QuickActions demoMode user={{id:'visibility-test',name:'Alex',role:'shop_tech'}} onOpen={()=>{}} onInspect={()=>{}}/>);
    expect(actions()).toContain('Inspect');
    expect(actions()).not.toContain('Shop');
    expect(actions()).not.toContain('Availability');
    expect(actions()).not.toContain('Task List');
    expect(actions()).not.toContain('Inventory');
    expect(actions()).not.toContain('VIPR Intelligence');
    await preferences!.save('inspections',false);
    expect(actions()).toBe('');
  });
  it('shows the same Quick Actions order for everyone, filtered only by role rules',()=>{
    const labels=(role:UserRole)=>[...renderToStaticMarkup(<QuickActions demoMode user={{id:`order-${role}`,name:'Alex',role}} onOpen={()=>{}} onInspect={()=>{}}/>).matchAll(/<strong>([^<]+)<\/strong>/g)].map(match=>match[1]);
    expect(labels('owner')).toEqual(['Availability','Task List','Payroll','Invoices']);
    expect(labels('shop_tech')).toEqual(['Availability','Inspect','Task List','Inventory','Payroll','Invoices']);
    expect(labels('resource_boss')).toEqual(['Availability','Inspect','Inventory','Payroll','Invoices']);
    expect(labels('fire_fighter')).toEqual(['Availability','Payroll','Invoices']);
  });
  it('shows the Command Center tiles first, then Quick Actions, then the Operations map once, without National Fire Activity',()=>{
    let preferences:ReturnType<typeof useDashboardPreferences>;
    function Probe(){preferences=useDashboardPreferences('map-order-test',true);return null}
    renderToStaticMarkup(<Probe/>);
    const html=renderToStaticMarkup(<OwnerDashboard canProcessPayroll preferences={preferences!} onCustomize={()=>{}} name="Alex" vehicles={[]} crew={[]} issues={[]} quickActions={<p>QA</p>} incidentMap={<p>MAP</p>} onSelect={()=>{}}/>);
    expect(html.match(/MAP/g)).toHaveLength(1);
    expect(html.indexOf('Command Center')).toBeLessThan(html.indexOf('Active Incidents'));
    expect(html.indexOf('Active Incidents')).toBeLessThan(html.indexOf('QA'));
    expect(html.indexOf('QA')).toBeLessThan(html.indexOf('MAP'));
    // National Fire Activity moved to the News Feed page.
    expect(html).not.toContain('National Fire Activity');
  });
  it('shows the Operations map even when an old saved preference hid the incident map',async()=>{
    let preferences:ReturnType<typeof useDashboardPreferences>;
    function Probe(){preferences=useDashboardPreferences('map-hidden-test',true);return null}
    renderToStaticMarkup(<Probe/>);
    await preferences!.save('incidentMap',false);
    renderToStaticMarkup(<Probe/>);
    const html=renderToStaticMarkup(<OwnerDashboard canProcessPayroll preferences={preferences!} onCustomize={()=>{}} name="Alex" vehicles={[]} crew={[]} issues={[]} incidentMap={<p>MAP</p>} onSelect={()=>{}}/>);
    expect(html).toContain('MAP');
  });
  it('renders grouped, accessible switches for each user',()=>{
    const html=renderToStaticMarkup(<DashboardCustomization userId="render-test" role="shop_tech" demoMode/>);
    expect(html).toContain('Command Center');
    expect(html).toContain('Quick Actions');
    expect(html).toContain('Recent Resources Activity');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Current issues');
    expect(html).not.toContain('Active Incidents');
    expect(html).not.toContain('Incident map');
    expect(html).toContain('Customize Operations');
    expect(html).not.toContain('Check out gear');
  });
});
