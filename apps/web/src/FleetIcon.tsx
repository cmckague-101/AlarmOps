import type {SVGProps} from 'react';

/**
 * Fleet tab mark: Lucide `Van` paths (stroke width 2 on a 24 viewBox),
 * matching Operations/Comms/News Feed/Tools nav peers.
 */
export function FleetIcon(props:SVGProps<SVGSVGElement>){
  return <svg viewBox="0 0 24 24" width={24} height={24} fill="none" aria-hidden="true" {...props}>
    <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 6v5a1 1 0 0 0 1 1h6.102a1 1 0 0 1 .712.298l.898.91a1 1 0 0 1 .288.702V17a1 1 0 0 1-1 1h-3"/>
      <path d="M5 18H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h12c1.1 0 2.1.8 2.4 1.8l1.176 4.2"/>
      <path d="M9 18h5"/>
      <circle cx="16" cy="18" r="2"/>
      <circle cx="7" cy="18" r="2"/>
    </g>
  </svg>;
}
