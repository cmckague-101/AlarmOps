import type {SVGProps} from 'react';

/**
 * Resources tab mark: outline fire truck + two people.
 * Stroke matches Lucide nav peers (Operations/Comms/News Feed/Tools): width 2 on a 24 viewBox.
 */
export function ResourcesIcon(props:SVGProps<SVGSVGElement>){
  return <svg viewBox="0 0 24 24" width={24} height={24} fill="none" aria-hidden="true" {...props}>
    <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {/* Light bar */}
      <path d="M5 5h3.5"/>
      {/* Cab + body facing left */}
      <path d="M3.5 17V9.25c0-.69.56-1.25 1.25-1.25h2.1L9 5.5h6.25c.69 0 1.25.56 1.25 1.25V17"/>
      {/* Cab window */}
      <path d="M5.25 9.25h2.75v2.75H5.25z"/>
      {/* Rear compartment */}
      <path d="M11.5 12.25h3.75V17"/>
      {/* Bumper + chassis gap */}
      <path d="M2.25 17H3.5"/>
      <path d="M8.5 17h2.25"/>
      {/* Wheels */}
      <circle cx="6.5" cy="17" r="2"/>
      <circle cx="13.5" cy="17" r="2"/>
      {/* Crew — front figure */}
      <circle cx="17.25" cy="10.25" r="2"/>
      <path d="M14.25 19a3 3 0 0 1 3-3 3 3 0 0 1 2.35 1.15"/>
      {/* Crew — rear figure */}
      <circle cx="20.6" cy="9.5" r="1.75"/>
      <path d="M22.75 19a2.8 2.8 0 0 0-2.5-2.75"/>
    </g>
  </svg>;
}
