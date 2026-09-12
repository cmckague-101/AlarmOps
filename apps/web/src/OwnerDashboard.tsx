import {useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, ChevronRight, Flame, Truck, Users} from 'lucide-react';
import {commandCenter, type CommandRow, type CrewMember, type FleetIssue, type Vehicle} from '@fireops/domain';

export function OwnerDashboard({quickActions,name,vehicles,crew,issues,onSelect}:{quickActions?:React.ReactNode;name:string;vehicles:Vehicle[];crew:CrewMember[];issues:FleetIssue[];onSelect:(target:NonNullable<CommandRow['target']>)=>void}) {
  const [selected,setSelected]=useState<string|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const cards=commandCenter(vehicles,crew,issues);
  const detail=cards.find(card=>card.id===selected);
  const icons=[Flame,Users,Truck,AlertTriangle];
  function navigate(id:string|null){setSelected(id);requestAnimationFrame(()=>{heading.current?.focus();heading.current?.scrollIntoView({block:'start'})})}
  return <div className="page owner-command">
    {detail?<><button className="command-back" onClick={()=>navigate(null)}><ArrowLeft/> Command Center</button><header><h1 ref={heading} tabIndex={-1}>{detail.title}</h1><p>{detail.description}</p></header><div className="command-list">{detail.rows.map(row=><article className="command-record" key={row.id}><div className="command-record-heading"><h2>{row.target?<button onClick={()=>onSelect(row.target!)}>{row.title}<ChevronRight/></button>:row.title}</h2><span className={`command-badge ${row.urgent?'urgent':''}`}>{row.badge}</span></div>{row.detail&&<p>{row.detail}</p>}{row.lines.map((line,index)=><div className="command-line" key={index}>{line}</div>)}</article>)}{!detail.rows.length&&<p className="command-empty">{detail.id==='attention'?'No open issues need attention.':`No ${detail.title.toLowerCase()} yet.`}</p>}</div></>:<><div className="command-greeting"><span>Hello,</span><strong>{name.trim().split(/\s+/)[0]||'there'}!</strong></div><header><h1 ref={heading} tabIndex={-1}>Command Center</h1><p>{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})} · Current Operational Status</p></header><div className="command-grid">{cards.map((card,index)=>{const Icon=icons[index];return <button className={`command-card command-${card.id}`} key={card.id} onClick={()=>navigate(card.id)}><span className="command-card-top"><Icon/><strong>{card.rows.length}</strong></span><h2>{card.title}</h2><p>{card.summary}</p><span className="command-link">View Details <ChevronRight/></span></button>})}</div>{quickActions}</>}
  </div>;
}
