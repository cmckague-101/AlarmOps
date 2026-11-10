import Svg,{Circle,Path} from 'react-native-svg';

/** VIPR Intelligence mark, same drawing as web's ViprIntelligenceIcon: shield with a V and an intelligence pulse. */
export function ViprIntelligenceIcon({size=24,color}:{size?:number;color:string}){
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
    <Path d="M12 2.4 19.6 6.2v5.4c0 4.55-3.15 8-7.6 9.6-4.45-1.6-7.6-5.05-7.6-9.6V6.2L12 2.4Z" stroke={color} strokeWidth={1.7} strokeLinejoin="round"/>
    <Path d="M8.15 9 12 16.35 15.85 9" stroke={color} strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round"/>
    <Circle cx={12} cy={7.35} r={1.15} fill={color}/>
    <Path d="M12 4.55a5.4 5.4 0 0 1 0 7.9" stroke={color} strokeWidth={1.35} strokeLinecap="round" opacity={0.45}/>
    <Path d="M12 3.35a7.2 7.2 0 0 1 0 10.3" stroke={color} strokeWidth={1.2} strokeLinecap="round" opacity={0.28}/>
  </Svg>;
}
