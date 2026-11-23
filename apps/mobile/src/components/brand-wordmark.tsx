import {Image,StyleSheet} from 'react-native';
import {useFireOpsColorScheme} from '@/theme';

/** AlarmOps wordmark. Pass `onDark` when the backdrop is always dark (e.g. sign-in hero). */
export function BrandWordmark({onDark}:{onDark?:boolean}={}){
  const schemeDark=useFireOpsColorScheme().colorScheme==='dark';
  const dark=onDark??schemeDark;
  return <Image accessibilityLabel="AlarmOps" resizeMode="contain" source={dark?require('../../assets/images/alarmops-wordmark-dark.png'):require('../../assets/images/alarmops-wordmark-light.png')} style={styles.image}/>;
}
const styles=StyleSheet.create({image:{width:260,height:87}});
