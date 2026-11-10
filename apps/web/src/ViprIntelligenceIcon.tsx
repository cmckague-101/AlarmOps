import type {SVGProps} from 'react';

/** VIPR Intelligence mark (More tile, Quick Action, sidebar): shield with a V and an intelligence pulse. */
export function ViprIntelligenceIcon(props:SVGProps<SVGSVGElement>){
  return <svg viewBox="0 0 24 24" width={24} height={24} fill="none" aria-hidden="true" {...props}>
    <path d="M12 2.4 19.6 6.2v5.4c0 4.55-3.15 8-7.6 9.6-4.45-1.6-7.6-5.05-7.6-9.6V6.2L12 2.4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
    <path d="M8.15 9 12 16.35 15.85 9" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="7.35" r="1.15" fill="currentColor"/>
    <path d="M12 4.55a5.4 5.4 0 0 1 0 7.9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity=".45"/>
    <path d="M12 3.35a7.2 7.2 0 0 1 0 10.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".28"/>
  </svg>;
}
