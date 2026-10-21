import {dashboardPreferenceGroups, type UserRole} from '@fireops/domain';
import {useDashboardPreferences} from './useDashboardPreferences';
import './DashboardCustomization.css';

export function DashboardCustomization({userId,role,demoMode}:{userId:string;role:UserRole;demoMode:boolean}) {
  const {visible,save,loading,saving,error,loadFailed,reload}=useDashboardPreferences(userId,demoMode);
  return <section id="dashboard-customization" className="company-profile-panel dashboard-customization" tabIndex={-1}>
    <header><div><h2>Customize Dashboard</h2><p>Choose what appears on your dashboard. Changes save automatically for your account.</p></div></header>
    {loading&&<p role="status">Loading dashboard preferences…</p>}
    {dashboardPreferenceGroups(role,'web').map(group=><fieldset key={group.title}><legend>{group.title}</legend>{group.items.map(item=><label key={item.id}>{item.label}<input type="checkbox" role="switch" checked={visible(item.id)} disabled={loading||saving||loadFailed} onChange={event=>void save(item.id,event.target.checked)}/></label>)}</fieldset>)}
    {saving&&<p role="status">Saving…</p>}{error&&<p role="alert" className="integration-error">{error}</p>}{loadFailed&&<button className="secondary" onClick={reload}>Try again</button>}
  </section>;
}
