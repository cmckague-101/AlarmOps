import Svg,{Circle,Path} from 'react-native-svg';

/**
 * Resources tab mark (same drawing as web ResourcesIcon): outline fire truck + two people.
 * Stroke matches Lucide nav peers (Operations/Comms/News Feed/Tools): width 2 on a 24 viewBox.
 */
export function ResourcesIcon({size=24,color}:{size?:number;color:string}){
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Path d="M5 5h3.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M3.5 17V9.25c0-.69.56-1.25 1.25-1.25h2.1L9 5.5h6.25c.69 0 1.25.56 1.25 1.25V17" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M5.25 9.25h2.75v2.75H5.25z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M11.5 12.25h3.75V17" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M2.25 17H3.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M8.5 17h2.25" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Circle cx={6.5} cy={17} r={2} stroke={color} strokeWidth={2}/>
    <Circle cx={13.5} cy={17} r={2} stroke={color} strokeWidth={2}/>
    <Circle cx={17.25} cy={10.25} r={2} stroke={color} strokeWidth={2}/>
    <Path d="M14.25 19a3 3 0 0 1 3-3 3 3 0 0 1 2.35 1.15" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Circle cx={20.6} cy={9.5} r={1.75} stroke={color} strokeWidth={2}/>
    <Path d="M22.75 19a2.8 2.8 0 0 0-2.5-2.75" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}
