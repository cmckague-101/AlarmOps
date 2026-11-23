import Svg,{Circle,Path} from 'react-native-svg';

/**
 * Fleet tab mark (same Lucide Van drawing as web FleetIcon).
 * Stroke matches Lucide nav peers: width 2 on a 24 viewBox.
 */
export function FleetIcon({size=24,color}:{size?:number;color:string}){
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Path d="M13 6v5a1 1 0 0 0 1 1h6.102a1 1 0 0 1 .712.298l.898.91a1 1 0 0 1 .288.702V17a1 1 0 0 1-1 1h-3" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M5 18H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h12c1.1 0 2.1.8 2.4 1.8l1.176 4.2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M9 18h5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Circle cx={16} cy={18} r={2} stroke={color} strokeWidth={2}/>
    <Circle cx={7} cy={18} r={2} stroke={color} strokeWidth={2}/>
  </Svg>;
}
