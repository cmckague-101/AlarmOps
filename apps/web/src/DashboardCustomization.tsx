import {dashboardPreferenceGroups, type UserRole} from '@fireops/domain';
import {useDashboardPreferences} from './useDashboardPreferences';
import './DashboardCustomization.css';

export function DashboardCustomization({userId,role,demoMode}:{userId:string;role:UserRole;demoMode:boolean}) {
  const {visible,save,loading,saving,error,loadFailed,reload,retryRequired,retry,pending}=useDashboardPreferences(userId,demoMode);
  const groups=dashboardPreferenceGroups(role,'web');
  const labels=Object.fromEntries(groups.flatMap(group=>group.items).map(item=>[item.id,item.label]));
  const proposed=pending?Object.entries(pending.request.changes).map(([key,value])=>`${labels[key]??key}: ${value===null?'default':value?'shown':'hidden'}`).join(', '):'';
  return <section id="dashboard-customization" className="company-profile-panel dashboard-customization" tabIndex={-1}>
    <header><div><h2>Customize Dashboard</h2><p>Choose what appears on your dashboard. Changes save automatically for your account.</p></div></header>
    {loading&&<p role="status">Loading dashboard preferences…</p>}
    {groups.map(group=><fieldset key={group.title}><legend>{group.title}</legend>{group.items.map(item=><label key={item.id}>{item.label}<input type="checkbox" role="switch" checked={visible(item.id)} disabled={loading||saving||loadFailed||retryRequired} onChange={event=>void save(item.id,event.target.checked)}/></label>)}</fieldset>)}
    {pending&&<p role="status">Submitted choice: {proposed}. {pending.acknowledged?'Saved on server; current layout refresh pending.':'Not yet confirmed. Keep this page open.'}</p>}
    {saving&&<p role="status">Saving…</p>}{error&&<p role="alert" className="integration-error">{error}</p>}{retryRequired&&!saving&&<button className="secondary" onClick={()=>void retry()}>{pending?.acknowledged?'Retry refresh':'Retry original choice'}</button>}{loadFailed&&!retryRequired&&<button className="secondary" onClick={reload}>Try again</button>}
  </section>;
}
