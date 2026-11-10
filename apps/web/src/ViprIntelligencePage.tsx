import {ArrowLeft,ChevronRight,ListOrdered,Upload} from 'lucide-react';
import {viprIntelligenceEntries,type UserRole,type ViprIntelligenceEntryId} from '@fireops/domain';

// Same accents as the phone app's VIPR Intelligence screen.
export const viprIntelligenceEntryStyle:Record<ViprIntelligenceEntryId,{Icon:typeof Upload;color:string}>={
  'send-to-vipr':{Icon:Upload,color:'#2F6A8F'},
  'vipr-dpls':{Icon:ListOrdered,color:'#C94321'},
};

/**
 * VIPR Intelligence hub: Send to VIPR (owners and admins, the same flow as Fleet's
 * Send to VIPR button) and VIPR DPLs (everyone).
 */
export function ViprIntelligencePage({role,onBack,onOpen}:{role:UserRole;onBack:()=>void;onOpen:(entry:ViprIntelligenceEntryId)=>void}) {
  const entries=viprIntelligenceEntries(role);
  return <div className="page vipr-intelligence-page">
    <button type="button" className="page-back" onClick={onBack}><ArrowLeft/> Back</button>
    <div className="page-heading hero-heading"><div><h1>VIPR Intelligence</h1><p>VIPR tools for your fleet and the USFS dispatch priority lists.</p></div></div>
    <section className="vipr-hub-list" aria-label="VIPR tools">
      {entries.map(entry=>{const {Icon,color}=viprIntelligenceEntryStyle[entry.id];return <button key={entry.id} type="button" className="vipr-hub-entry" style={{['--tile-stripe' as string]:color}} onClick={()=>onOpen(entry.id)}>
        <span className="vipr-hub-icon" style={{background:color}}><Icon/></span>
        <span className="vipr-hub-copy"><b>{entry.label}</b><small>{entry.description}</small></span>
        <ChevronRight className="vipr-hub-chevron"/>
      </button>})}
    </section>
  </div>;
}
